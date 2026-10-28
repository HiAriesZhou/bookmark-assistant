import { Client } from '@notionhq/client';
import {
  buildBookmarkPropertiesFromNotionSchema,
  extractNotionPageLinkKeys,
  getNotionRetryDelayMs,
  getPrimaryNotionDataSourceId,
  isReadOnlyNotionPropertyType,
  isRetryableNotionError,
  type ExistingLinkRecord,
} from './core';
import type { NotionLinkWriter } from './types';
import type { LinkItem } from '@bookmark-assistant/types';

export const NOTION_API_VERSION = '2025-09-03';
// Notion allows about three requests per second per connection.
const REQUEST_SPACING_MS = 334;
const REQUEST_TIMEOUT_MS = 30_000;
const SCHEMA_CACHE_MS = 5 * 60_000;
// A safety stop for a cursor that never ends: 100,000 rows.
const MAX_EXISTING_PAGES = 1_000;

type NotionClient = Pick<Client, 'request' | 'search' | 'pages' | 'users' | 'dataSources'>;

export type CreateNotionClient = (token: string) => NotionClient;

// The service worker's fetch must not be called as a method of another object.
const defaultCreateClient: CreateNotionClient = (token) =>
  new Client({
    auth: token,
    notionVersion: NOTION_API_VERSION,
    fetch: (input, init) => fetch(input, init),
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type NotionTarget = { id: string; title: string };

// Fields of a database the extension creates; names match the property matchers.
export const BOOKMARK_DATABASE_PROPERTIES = {
  Name: { title: {} },
  URL: { url: {} },
  Tags: { multi_select: {} },
  Description: { rich_text: {} },
  Folder: { rich_text: {} },
  'Date Added': { date: {} },
  'Sync ID': { rich_text: {} },
  Source: { select: { options: [{ name: 'Bookmark' }, { name: 'ReadingList' }] } },
  Type: { select: { options: [{ name: 'Bookmark' }, { name: 'Reading List' }] } },
  Status: { select: { options: [{ name: 'Unread' }, { name: 'Done' }] } },
} as const;

const plainTitle = (parts: unknown) =>
  Array.isArray(parts) ? parts.map((part: any) => part?.plain_text || '').join('') : '';

function pageTitle(page: any): string {
  const title = Object.values<any>(page?.properties || {}).find(
    (property) => property?.type === 'title'
  );
  return plainTitle(title?.title);
}

export interface ExistingLinks {
  urls: string[];
  syncIds: string[];
  records: ExistingLinkRecord[];
}

/**
 * Notion requests for one browser profile, with the same pacing, retries and schema
 * cache the server used. Every call takes the user's token, as the shared writer expects.
 */
export class NotionApi implements NotionLinkWriter {
  private readonly clients = new Map<string, NotionClient>();
  private readonly schemaCache = new Map<string, { expiresAt: number; schema: any }>();
  private readonly schemaRequests = new Map<string, Promise<any>>();
  private nextRequestAt = 0;
  private readonly createClient: CreateNotionClient;
  private readonly wait: (ms: number) => Promise<unknown>;

  constructor(
    createClient: CreateNotionClient = defaultCreateClient,
    wait: (ms: number) => Promise<unknown> = sleep
  ) {
    this.createClient = createClient;
    this.wait = wait;
  }

  private client(token: string): NotionClient {
    let client = this.clients.get(token);
    if (!client) {
      client = this.createClient(token);
      this.clients.set(token, client);
    }
    return client;
  }

  private async waitForRequestSlot(): Promise<void> {
    const scheduledAt = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + REQUEST_SPACING_MS;
    const waitMs = scheduledAt - Date.now();
    if (waitMs > 0) await this.wait(waitMs);
  }

  private async withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.waitForRequestSlot();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Notion request timed out')),
            REQUEST_TIMEOUT_MS
          );
        });
        try {
          return await Promise.race([operation(), timeout]);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        if (attempt >= maxRetries || !isRetryableNotionError(error)) throw error;
        await this.wait(getNotionRetryDelayMs(error, attempt));
      }
    }
  }

  /** The token's identity: a person for personal access tokens, a bot for integrations. */
  async getSelf(token: string): Promise<{ name?: string; workspaceName?: string }> {
    const self: any = await this.withRetry(() => this.client(token).users.me({}));
    return {
      name: typeof self?.name === 'string' ? self.name : undefined,
      workspaceName:
        typeof self?.bot?.workspace_name === 'string' ? self.bot.workspace_name : undefined,
    };
  }

  /**
   * Databases and standalone pages the token can open, for choosing where to sync.
   * Database rows are not offered as parents.
   */
  async listTargets(token: string): Promise<{ databases: NotionTarget[]; pages: NotionTarget[] }> {
    const [dataSources, pages]: any[] = await Promise.all([
      this.withRetry(() =>
        this.client(token).search({
          filter: { property: 'object', value: 'data_source' },
          page_size: 100,
        } as any)
      ),
      this.withRetry(() =>
        this.client(token).search({
          filter: { property: 'object', value: 'page' },
          page_size: 100,
        } as any)
      ),
    ]);
    const databases = new Map<string, NotionTarget>();
    for (const result of dataSources?.results || []) {
      // Search may return a partial data source without its parent; read it once more.
      const source =
        result?.parent || typeof result?.id !== 'string'
          ? result
          : await this.withRetry(() =>
              this.client(token).dataSources.retrieve({ data_source_id: result.id })
            ).catch(() => null);
      const databaseId = (source as any)?.parent?.database_id;
      if (typeof databaseId === 'string' && !databases.has(databaseId)) {
        databases.set(databaseId, { id: databaseId, title: plainTitle((source as any).title) });
      }
    }
    return {
      databases: [...databases.values()],
      pages: (pages?.results || [])
        .filter(
          (page: any) =>
            typeof page?.id === 'string' &&
            !['database_id', 'data_source_id'].includes(page?.parent?.type)
        )
        .map((page: any) => ({ id: page.id, title: pageTitle(page) })),
    };
  }

  /** Creates a bookmark database under a page the token can edit. */
  async createBookmarkDatabase(
    token: string,
    parentPageId: string,
    title: string
  ): Promise<{ databaseId: string }> {
    await this.waitForRequestSlot();
    const database: any = await this.client(token).request({
      method: 'post',
      path: 'databases',
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ type: 'text', text: { content: title } }],
        initial_data_source: { properties: BOOKMARK_DATABASE_PROPERTIES },
      },
    });
    if (typeof database?.id !== 'string') throw new Error('Notion did not create the database');
    return { databaseId: database.id };
  }

  private async getDataSourceSchema(dataSourceId: string, token: string): Promise<any> {
    const cached = this.schemaCache.get(dataSourceId);
    if (cached && cached.expiresAt > Date.now()) return cached.schema;
    const pending = this.schemaRequests.get(dataSourceId);
    if (pending) return pending;

    const request = this.withRetry(() =>
      this.client(token).dataSources.retrieve({ data_source_id: dataSourceId })
    )
      .then((schema) => {
        this.schemaCache.set(dataSourceId, { schema, expiresAt: Date.now() + SCHEMA_CACHE_MS });
        return schema;
      })
      .finally(() => this.schemaRequests.delete(dataSourceId));
    this.schemaRequests.set(dataSourceId, request);
    return request;
  }

  /** Confirms the token can open the database and returns its primary data source. */
  async verifyDatabaseAccess(
    databaseId: string,
    token: string
  ): Promise<{ databaseId: string; dataSourceId: string; title?: string }> {
    const database: any = await this.withRetry(() =>
      this.client(token).request({ method: 'get', path: `databases/${databaseId}` })
    );
    if (database?.object !== 'database') {
      throw new Error('The selected Notion page is not a database');
    }
    const dataSourceId = getPrimaryNotionDataSourceId(database);
    if (!dataSourceId) throw new Error('The Notion database has no data source');
    const title = Array.isArray(database.title)
      ? database.title.map((part: any) => part?.plain_text || '').join('')
      : undefined;
    return { databaseId, dataSourceId, title: title || undefined };
  }

  async buildPropertiesFromDataSource(
    dataSourceId: string,
    token: string,
    item: LinkItem
  ): Promise<Record<string, unknown>> {
    const dataSource = await this.getDataSourceSchema(dataSourceId, token);
    const schema = dataSource?.properties || {};
    const hasWritableTitle = Object.values<any>(schema).some(
      (definition) =>
        definition?.type === 'title' && !isReadOnlyNotionPropertyType(definition?.type)
    );
    const fallbackTitlePropertyName = hasWritableTitle
      ? undefined
      : Object.entries<any>(schema).find(([, definition]) => definition?.type === 'title')?.[0];
    return buildBookmarkPropertiesFromNotionSchema(schema, item, {
      fallbackTitlePropertyName,
    }) as Record<string, unknown>;
  }

  /** Creating a page is not idempotent, so it is never retried here; the writer reconciles. */
  async createPage(
    parent: { type: 'database_id'; database_id: string },
    properties: Record<string, unknown>,
    token: string,
    children?: undefined,
    iconUrl?: string
  ): Promise<unknown> {
    await this.waitForRequestSlot();
    return this.client(token).pages.create({
      parent,
      properties,
      children,
      ...(iconUrl ? { icon: { type: 'external', external: { url: iconUrl } } } : {}),
    } as any);
  }

  async updatePage(
    pageId: string,
    properties: Record<string, unknown>,
    token: string
  ): Promise<unknown> {
    return this.withRetry(() =>
      this.client(token).pages.update({ page_id: pageId, properties } as any)
    );
  }

  async findPageBySyncId(
    dataSourceId: string,
    token: string,
    syncId: string
  ): Promise<string | undefined> {
    const dataSource = await this.getDataSourceSchema(dataSourceId, token);
    const syncIdProperty = Object.entries<any>(dataSource?.properties || {}).find(
      ([name, definition]) =>
        definition?.type === 'rich_text' &&
        (/sync.*id/i.test(name) || /identifier/i.test(name) || /^id$/i.test(name))
    )?.[0];
    if (!syncIdProperty) return undefined;
    const response: any = await this.withRetry(() =>
      this.client(token).dataSources.query({
        data_source_id: dataSourceId,
        filter: { property: syncIdProperty, rich_text: { equals: syncId } },
        page_size: 1,
      } as any)
    );
    const pageId = response?.results?.[0]?.id;
    return typeof pageId === 'string' ? pageId : undefined;
  }

  /**
   * Reads every existing row to plan creates and updates. A failed read fails the sync:
   * planning against a partial index would create duplicates of the rows it missed.
   */
  async existingLinks(dataSourceId: string, token: string): Promise<ExistingLinks> {
    const result: ExistingLinks = { urls: [], syncIds: [], records: [] };
    let cursor: string | undefined;
    for (let page = 0; page < MAX_EXISTING_PAGES; page++) {
      const response: any = await this.withRetry(() =>
        this.client(token).dataSources.query({
          data_source_id: dataSourceId,
          page_size: 100,
          start_cursor: cursor,
        } as any)
      );
      for (const row of response?.results || []) {
        const { url, syncId, type, readState } = extractNotionPageLinkKeys(row);
        if (url) result.urls.push(url);
        if (syncId) result.syncIds.push(syncId);
        if (url || syncId) {
          result.records.push({
            pageId: typeof row.id === 'string' ? row.id : undefined,
            url,
            syncId,
            type,
            readState,
          });
        }
      }
      cursor = response?.next_cursor || undefined;
      if (!cursor) return result;
    }
    throw new Error('The Notion database has too many rows to check for duplicates');
  }
}

export const notionApi = new NotionApi();
