import { describe, expect, it, vi } from 'vitest';
import type { LinkItem } from '@bookmark-assistant/types';
import { syncLinksToNotion } from './sync';

const CONNECTION = { token: 'ntn_test', databaseId: 'db-1' };
const noWait = async () => undefined;

function fakeApi(existingRecords: any[] = []) {
  return {
    verifyDatabaseAccess: vi.fn(async () => ({ databaseId: 'db-1', dataSourceId: 'ds-1' })),
    existingLinks: vi.fn(async () => ({
      urls: existingRecords.map((record) => record.url).filter(Boolean),
      syncIds: existingRecords.map((record) => record.syncId).filter(Boolean),
      records: existingRecords,
    })),
    buildPropertiesFromDataSource: vi.fn(async () => ({})),
    createPage: vi.fn(async () => ({ id: 'created-page' })),
    updatePage: vi.fn(async () => ({})),
    findPageBySyncId: vi.fn(async () => undefined),
  };
}

const link = (syncId: string, extra: Partial<LinkItem> = {}): LinkItem =>
  ({
    title: `Title ${syncId}`,
    url: `https://${syncId}.example/`,
    syncId,
    type: 'bookmark',
    folder: 'Bookmarks Bar',
    tags: [],
    ...extra,
  }) as LinkItem;

describe('syncLinksToNotion', () => {
  it('creates new links and skips rows that already exist', async () => {
    const api = fakeApi([
      { pageId: 'page-old', syncId: 'old', url: 'https://old.example/', type: 'bookmark' },
    ]);
    const response = await syncLinksToNotion(api, CONNECTION, [link('old'), link('new')], {
      wait: noWait,
    });
    expect(api.createPage).toHaveBeenCalledTimes(1);
    expect(api.createPage.mock.calls[0][0]).toEqual({ type: 'database_id', database_id: 'db-1' });
    expect(response.summary).toMatchObject({ total: 2, success: 1, failed: 0, skippedExisting: 1 });
    expect(response.results[0]).toMatchObject({ success: true, action: 'created', syncId: 'new' });
  });

  it('updates a reading-list row whose read state changed', async () => {
    const api = fakeApi([
      {
        pageId: 'page-r',
        syncId: 'r',
        url: 'https://r.example/',
        type: 'reading_list',
        readState: 'UNREAD',
      },
    ]);
    const response = await syncLinksToNotion(
      api,
      CONNECTION,
      [link('r', { type: 'reading_list', readState: 'READ' } as Partial<LinkItem>)],
      { wait: noWait }
    );
    expect(api.updatePage).toHaveBeenCalledWith('page-r', {}, 'ntn_test');
    expect(response.summary).toMatchObject({
      updated: 1,
      readingListTotal: 1,
      readingListSuccess: 1,
    });
  });

  it('reports a permanent failure without retrying it', async () => {
    const api = fakeApi();
    api.createPage.mockRejectedValue(
      Object.assign(new Error('validation failed'), { status: 400 })
    );
    const response = await syncLinksToNotion(api, CONNECTION, [link('bad')], { wait: noWait });
    expect(api.createPage).toHaveBeenCalledTimes(1);
    expect(response.summary).toMatchObject({ success: 0, failed: 1 });
  });

  it('recovers a link after a transient failure', async () => {
    const api = fakeApi();
    api.createPage
      .mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { status: 503 }))
      .mockResolvedValue({ id: 'created-page' });
    const response = await syncLinksToNotion(api, CONNECTION, [link('flaky')], { wait: noWait });
    expect(response.summary).toMatchObject({ success: 1, failed: 0 });
  });

  it('stops writing once the connection that started the sync is no longer current', async () => {
    const api = fakeApi();
    let current = true;
    const assertCurrent = vi.fn(async () => {
      if (!current) throw new Error('stale connection');
    });
    api.existingLinks.mockImplementation(async () => {
      current = false; // The user disconnected while existing rows were being read.
      return { urls: [], syncIds: [], records: [] };
    });
    await expect(
      syncLinksToNotion(api, CONNECTION, [link('a'), link('b')], { wait: noWait, assertCurrent })
    ).rejects.toThrow('stale connection');
    expect(api.createPage).not.toHaveBeenCalled();
  });

  it('fails the whole sync when the database cannot be opened', async () => {
    const api = fakeApi();
    api.verifyDatabaseAccess.mockRejectedValue(new Error('object_not_found'));
    await expect(syncLinksToNotion(api, CONNECTION, [link('a')], { wait: noWait })).rejects.toThrow(
      'object_not_found'
    );
    expect(api.createPage).not.toHaveBeenCalled();
  });
});
