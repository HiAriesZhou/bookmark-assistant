import type { LinkItem } from '@bookmark-assistant/types';

export type NotionLinkWriteAction = 'created' | 'updated';

export type NotionLinkWriteResult =
  | {
      success: true;
      bookmark: string;
      action: NotionLinkWriteAction;
      syncId?: string;
      /** Present when the Notion API returned the page created by this write. */
      notionPageId?: string;
    }
  | {
      success: false;
      bookmark: string;
      error: string;
      syncId?: string;
    };

export interface NotionLinkWriter {
  buildPropertiesFromDataSource(
    dataSourceId: string,
    accessToken: string,
    item: LinkItem
  ): Promise<Record<string, unknown>>;
  createPage(
    parent: { type: 'database_id'; database_id: string },
    properties: Record<string, unknown>,
    accessToken: string,
    children?: undefined,
    iconUrl?: string
  ): Promise<unknown>;
  updatePage(
    pageId: string,
    properties: Record<string, unknown>,
    accessToken: string
  ): Promise<unknown>;
  findPageBySyncId?(
    dataSourceId: string,
    accessToken: string,
    syncId: string
  ): Promise<string | undefined>;
}

export interface WriteLinkItemToNotionOptions {
  writer: NotionLinkWriter;
  dataSourceId: string;
  databaseId?: string;
  accessToken: string;
  item: LinkItem;
  pageId?: string;
  buildIconUrl: (url: string) => string | undefined;
  sanitizeError: (error: unknown) => string;
}
