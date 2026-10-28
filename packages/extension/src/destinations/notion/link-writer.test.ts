import { describe, expect, it, vi } from 'vitest';
import { writeLinkItemToNotion } from './link-writer';
import type { NotionLinkWriter } from './types';

function createWriter(): NotionLinkWriter {
  return {
    buildPropertiesFromDataSource: vi.fn().mockResolvedValue({ Name: { title: [] } }),
    createPage: vi.fn().mockResolvedValue({ id: 'page-1' }),
    updatePage: vi.fn().mockResolvedValue({ id: 'page-1' }),
  };
}

const item = {
  title: 'Example link',
  url: 'https://example.com/article',
  syncId: 'chrome-bookmark-42',
  source: 'chrome_bookmark' as const,
};

describe('Notion link adapter', () => {
  it('creates a page with the existing database parent and normalized result', async () => {
    const writer = createWriter();

    await expect(
      writeLinkItemToNotion({
        writer,
        databaseId: 'database-1',
        dataSourceId: 'data-source-1',
        accessToken: 'test-token',
        item,
        buildIconUrl: () => 'https://icons.example/favicon.ico',
        sanitizeError: String,
      })
    ).resolves.toEqual({
      success: true,
      bookmark: item.title,
      action: 'created',
      syncId: item.syncId,
      notionPageId: 'page-1',
    });

    expect(writer.buildPropertiesFromDataSource).toHaveBeenCalledWith(
      'data-source-1',
      'test-token',
      item
    );
    expect(writer.createPage).toHaveBeenCalledWith(
      { type: 'database_id', database_id: 'database-1' },
      { Name: { title: [] } },
      'test-token',
      undefined,
      'https://icons.example/favicon.ico'
    );
  });

  it('updates an existing page without creating another page', async () => {
    const writer = createWriter();

    await expect(
      writeLinkItemToNotion({
        writer,
        dataSourceId: 'data-source-1',
        accessToken: 'test-token',
        item,
        pageId: 'page-1',
        buildIconUrl: () => 'unused',
        sanitizeError: String,
      })
    ).resolves.toEqual({
      success: true,
      bookmark: item.title,
      action: 'updated',
      syncId: item.syncId,
      notionPageId: 'page-1',
    });

    expect(writer.updatePage).toHaveBeenCalledWith('page-1', { Name: { title: [] } }, 'test-token');
    expect(writer.createPage).not.toHaveBeenCalled();
  });

  it('returns the existing result shape when a Notion write fails', async () => {
    const writer = createWriter();
    vi.mocked(writer.createPage).mockRejectedValue(new Error('Notion unavailable'));

    await expect(
      writeLinkItemToNotion({
        writer,
        databaseId: 'database-1',
        dataSourceId: 'data-source-1',
        accessToken: 'test-token',
        item,
        buildIconUrl: () => 'unused',
        sanitizeError: (error) => (error instanceof Error ? error.message : 'unknown'),
      })
    ).resolves.toEqual({
      success: false,
      bookmark: item.title,
      error: 'Notion unavailable',
      syncId: item.syncId,
    });
  });

  it('reconciles a transient create failure before retrying', async () => {
    const writer = createWriter();
    writer.findPageBySyncId = vi.fn().mockResolvedValue('page-created-before-502');
    vi.mocked(writer.createPage).mockRejectedValue({ status: 502, message: 'Bad Gateway' });

    await expect(
      writeLinkItemToNotion({
        writer,
        databaseId: 'database-1',
        dataSourceId: 'data-source-1',
        accessToken: 'test-token',
        item,
        buildIconUrl: () => 'unused',
        sanitizeError: String,
      })
    ).resolves.toMatchObject({ success: true, action: 'created', syncId: item.syncId });

    expect(writer.findPageBySyncId).toHaveBeenCalledWith(
      'data-source-1',
      'test-token',
      item.syncId
    );
    expect(writer.createPage).toHaveBeenCalledTimes(1);
  });

  it('retries once only after reconciliation confirms the page is absent', async () => {
    const writer = createWriter();
    writer.findPageBySyncId = vi.fn().mockResolvedValue(undefined);
    vi.mocked(writer.createPage)
      .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
      .mockResolvedValueOnce({ id: 'page-after-retry' });

    await expect(
      writeLinkItemToNotion({
        writer,
        databaseId: 'database-1',
        dataSourceId: 'data-source-1',
        accessToken: 'test-token',
        item,
        buildIconUrl: () => 'unused',
        sanitizeError: String,
      })
    ).resolves.toMatchObject({ success: true, action: 'created', syncId: item.syncId });

    expect(writer.createPage).toHaveBeenCalledTimes(2);
  });
});
