import { describe, expect, it } from 'vitest';
import {
  collectBookmarkSyncItems,
  createSyncFingerprint,
  formatBookmarkForSync,
  formatSavedLinkForSync,
} from './links';

describe('createSyncFingerprint', () => {
  it('changes when reading list readState changes', async () => {
    const unread = await createSyncFingerprint(
      [
        {
          url: 'https://example.com/article',
          title: 'Article',
          path: 'Reading List',
          type: 'reading_list',
          source: 'reading_list',
          readState: 'UNREAD',
          syncId: 'reading-list-article',
        },
      ],
      { crypto: null }
    );
    const read = await createSyncFingerprint(
      [
        {
          url: 'https://example.com/article',
          title: 'Article',
          path: 'Reading List',
          type: 'reading_list',
          source: 'reading_list',
          readState: 'READ',
          syncId: 'reading-list-article',
        },
      ],
      { crypto: null }
    );

    expect(read).not.toBe(unread);
  });
});

describe('capture source and identity', () => {
  const now = () => new Date('2026-08-12T10:00:00.000Z');

  it('marks Chrome bookmarks with an explicit source and stable sync ID', () => {
    expect(
      formatBookmarkForSync(
        { id: '42', title: 'Bookmark', url: 'https://example.com', dateAdded: 0 },
        'Bookmarks',
        { now }
      )
    ).toMatchObject({
      source: 'chrome_bookmark',
      syncId: 'chrome-bookmark-42',
    });
  });

  it('keeps source and stable identity in bulk-sync fingerprints', async () => {
    const result = await collectBookmarkSyncItems(
      [{ id: '42', title: 'Bookmark', url: 'https://example.com' }],
      { now }
    );

    expect(result.items[0]).toMatchObject({
      source: 'chrome_bookmark',
      syncId: 'chrome-bookmark-42',
    });
    expect(result.fingerprintItems).toEqual([
      expect.objectContaining({
        source: 'chrome_bookmark',
        syncId: 'chrome-bookmark-42',
      }),
    ]);
  });

  it('preserves an explicit source for right-click captures', () => {
    expect(
      formatSavedLinkForSync(
        { title: 'Link', url: 'https://example.com' },
        { now, createSyncId: () => 'context-1', source: 'context_menu' }
      )
    ).toMatchObject({ source: 'context_menu', syncId: 'context-1' });
  });
});
