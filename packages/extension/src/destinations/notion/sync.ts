import type { BookmarkSyncResponse, BookmarkSyncResult, LinkItem } from '@bookmark-assistant/types';
import {
  buildGoogleS2FaviconUrl,
  diffLinkItems,
  mergeRetryResults,
  selectRetryableSyncFailures,
  validateBookmarkInput,
  type PlannedLinkUpdate,
} from './core';
import { writeLinkItemToNotion } from './link-writer';
import type { NotionApi } from './notion-api';

// Parallel writes per batch, as on the server; the API client paces the requests.
const WRITE_CONCURRENCY = 3;
const RETRY_DELAY_MS = 1_500;

export interface NotionConnection {
  token: string;
  databaseId: string;
}

type Writer = Pick<
  NotionApi,
  | 'verifyDatabaseAccess'
  | 'existingLinks'
  | 'buildPropertiesFromDataSource'
  | 'createPage'
  | 'updatePage'
  | 'findPageBySyncId'
>;

export interface SyncLinksOptions {
  wait?: (ms: number) => Promise<unknown>;
  createSyncId?: () => string;
}

const sanitizeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Writes links straight to the user's Notion database: verify access, read existing rows,
 * create new rows and update changed ones. The response matches the old server sync, so the
 * background's fingerprints and summaries work unchanged.
 */
export async function syncLinksToNotion(
  api: Writer,
  connection: NotionConnection,
  links: LinkItem[],
  options: SyncLinksOptions = {}
): Promise<BookmarkSyncResponse> {
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const createSyncId = options.createSyncId ?? (() => crypto.randomUUID());
  const { token } = connection;
  const { databaseId, dataSourceId } = await api.verifyDatabaseAccess(connection.databaseId, token);
  const items = links.map((link) => validateBookmarkInput(link, { createSyncId }));
  const existing = await api.existingLinks(dataSourceId, token);
  const plan = diffLinkItems(items, existing.records, existing.urls, existing.syncIds);

  const write = (item: LinkItem, pageId?: string) =>
    writeLinkItemToNotion({
      writer: api,
      databaseId,
      dataSourceId,
      accessToken: token,
      item,
      pageId,
      buildIconUrl: buildGoogleS2FaviconUrl,
      sanitizeError,
    });

  const results: BookmarkSyncResult[] = [];
  for (const batch of chunk(plan.toCreate, WRITE_CONCURRENCY)) {
    let batchResults = await Promise.all(batch.map((item) => write(item)));
    // One more attempt for transient failures, matched back to their item.
    const retryable = selectRetryableSyncFailures(batchResults);
    if (retryable.length > 0) {
      await wait(RETRY_DELAY_MS);
      const retried = await Promise.all(
        retryable.map(async (failed) => {
          const item = batch.find((candidate) =>
            failed.syncId ? candidate.syncId === failed.syncId : candidate.title === failed.bookmark
          );
          if (!item) return { ...failed, retryCount: 1 };
          const result = await write(item);
          return result.success ? { ...result, retryCount: 1 } : { ...failed, retryCount: 1 };
        })
      );
      batchResults = mergeRetryResults(batchResults, retried);
    }
    results.push(...batchResults);
  }
  for (const batch of chunk<PlannedLinkUpdate>(plan.toUpdate ?? [], WRITE_CONCURRENCY)) {
    results.push(...(await Promise.all(batch.map(({ pageId, item }) => write(item, pageId)))));
  }

  return { success: true, results, summary: summarize(items, results, plan) };
}

function summarize(
  items: LinkItem[],
  results: BookmarkSyncResult[],
  plan: ReturnType<typeof diffLinkItems>
): BookmarkSyncResponse['summary'] {
  const success = results.filter((result) => result.success).length;
  const readingListIds = new Set(
    items.filter((item) => item.type === 'reading_list' && item.syncId).map((item) => item.syncId)
  );
  const readingListResults = results.filter(
    (result) => result.syncId && readingListIds.has(result.syncId)
  );
  const readingListTotal = items.filter((item) => item.type === 'reading_list').length;
  return {
    total: items.length,
    success,
    failed: results.length - success,
    batchSize: WRITE_CONCURRENCY,
    skippedExisting: plan.skippedExisting,
    duplicatesBySyncId: plan.stats.matchedBySyncId,
    duplicatesByUrl: (plan.stats.matchedByUrl || 0) + (plan.stats.matchedByTypedUrl || 0),
    updated: results.filter((result) => result.success && result.action === 'updated').length,
    readingListTotal,
    readingListSuccess: readingListResults.filter((result) => result.success).length,
    readingListFailed: readingListResults.filter((result) => !result.success).length,
    readingListSkippedExisting: Math.max(0, readingListTotal - readingListResults.length),
    deferred: 0,
  };
}
