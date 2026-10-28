import type { NotionLinkWriteResult, WriteLinkItemToNotionOptions } from './types';
import { isRetryableNotionError } from './core';

/**
 * The first Notion sink seam. It deliberately accepts the legacy LinkItem
 * compatibility payload while the route continues to own users, OAuth and planning.
 */
export async function writeLinkItemToNotion(
  options: WriteLinkItemToNotionOptions
): Promise<NotionLinkWriteResult> {
  const {
    writer,
    dataSourceId,
    databaseId,
    accessToken,
    item,
    pageId,
    buildIconUrl,
    sanitizeError,
  } = options;

  try {
    const properties = await writer.buildPropertiesFromDataSource(dataSourceId, accessToken, item);

    if (pageId) {
      await writer.updatePage(pageId, properties, accessToken);
      return {
        success: true,
        bookmark: item.title,
        action: 'updated',
        syncId: item.syncId,
        notionPageId: pageId,
      };
    }

    if (!databaseId) {
      throw new Error('Database ID is required when creating a Notion page');
    }

    const parent = { type: 'database_id' as const, database_id: databaseId };
    const iconUrl = buildIconUrl(item.url);
    let notionPageId: string | undefined;

    try {
      const createdPage = await writer.createPage(
        parent,
        properties,
        accessToken,
        undefined,
        iconUrl
      );
      notionPageId = readNotionPageId(createdPage);
    } catch (error) {
      if (!item.syncId || !writer.findPageBySyncId || !isRetryableNotionError(error)) {
        throw error;
      }

      // A 5xx response may arrive after Notion accepted the create. Reconcile using
      // the stable sync ID before attempting one safe retry to avoid duplicates.
      const existingPageId = await writer.findPageBySyncId(dataSourceId, accessToken, item.syncId);
      if (existingPageId) {
        return {
          success: true,
          bookmark: item.title,
          action: 'created',
          syncId: item.syncId,
          notionPageId: existingPageId,
        };
      }

      const createdPage = await writer.createPage(
        parent,
        properties,
        accessToken,
        undefined,
        iconUrl
      );
      notionPageId = readNotionPageId(createdPage);
    }

    return {
      success: true,
      bookmark: item.title,
      action: 'created',
      syncId: item.syncId,
      ...(notionPageId ? { notionPageId } : {}),
    };
  } catch (error) {
    return {
      success: false,
      bookmark: item.title,
      error: sanitizeError(error),
      syncId: item.syncId,
    };
  }
}

function readNotionPageId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}
