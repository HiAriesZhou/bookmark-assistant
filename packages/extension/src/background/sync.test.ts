/**
 * Unit tests for sync functionality
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBookmarkPath, syncAllBookmarksToNotion, flattenBookmarks } from './sync';

// Mock chrome API
const mockChrome = {
  bookmarks: {
    getTree: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', mockChrome);

// Mock server API
vi.mock('./server-api', () => ({
  serverAPI: {
    syncBookmarks: vi.fn(),
  },
}));

describe('Sync Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildBookmarkPath', () => {
    it('should build path for bookmark in root folder', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Folder 1',
              children: [
                {
                  id: '3',
                  title: 'Bookmark 1',
                  url: 'https://example.com',
                },
              ],
            },
          ],
        },
      ];

      const path = buildBookmarkPath(bookmarkTree, '3');

      expect(path).toBe('Bookmarks Bar / Folder 1');
    });

    it('should handle nested folders', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Folder 1',
              children: [
                {
                  id: '3',
                  title: 'Folder 2',
                  children: [
                    {
                      id: '4',
                      title: 'Bookmark 1',
                      url: 'https://example.com',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const path = buildBookmarkPath(bookmarkTree, '4');

      expect(path).toBe('Bookmarks Bar / Folder 1 / Folder 2');
    });

    it('should return "Bookmarks" for non-existent bookmark', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Folder 1',
              url: 'https://example.com',
            },
          ],
        },
      ];

      const path = buildBookmarkPath(bookmarkTree, 'non-existent');

      expect(path).toBe('Bookmarks');
    });

    it('should filter out empty titles', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: '',
              children: [
                {
                  id: '3',
                  title: 'Bookmark 1',
                  url: 'https://example.com',
                },
              ],
            },
          ],
        },
      ];

      const path = buildBookmarkPath(bookmarkTree, '3');

      expect(path).toBe('Bookmarks Bar');
    });

    it('should handle bookmark directly under root', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Bookmark 1',
              url: 'https://example.com',
            },
          ],
        },
      ];

      const path = buildBookmarkPath(bookmarkTree, '2');

      expect(path).toBe('Bookmarks Bar');
    });
  });

  describe('flattenBookmarks', () => {
    it('should flatten bookmark tree to extract URLs only', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Folder 1',
              parentId: '1',
              children: [
                {
                  id: '3',
                  title: 'Bookmark 1',
                  url: 'https://example1.com',
                  parentId: '2',
                },
                {
                  id: '4',
                  title: 'Bookmark 2',
                  url: 'https://example2.com',
                  parentId: '2',
                },
              ],
            },
            {
              id: '5',
              title: 'Bookmark 3',
              url: 'https://example3.com',
              parentId: '1',
            },
          ],
        },
      ];

      const flattened = flattenBookmarks(bookmarkTree);

      expect(flattened).toHaveLength(3);
      expect(flattened[0]).toEqual({
        id: '3',
        title: 'Bookmark 1',
        url: 'https://example1.com',
        parentId: '2',
      });
      expect(flattened[1]).toEqual({
        id: '4',
        title: 'Bookmark 2',
        url: 'https://example2.com',
        parentId: '2',
      });
      expect(flattened[2]).toEqual({
        id: '5',
        title: 'Bookmark 3',
        url: 'https://example3.com',
        parentId: '1',
      });
    });

    it('should ignore folders without URLs', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            {
              id: '2',
              title: 'Folder 1',
              children: [],
            },
          ],
        },
      ];

      const flattened = flattenBookmarks(bookmarkTree);

      expect(flattened).toHaveLength(0);
    });

    it('should handle empty bookmark tree', () => {
      const bookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [];

      const flattened = flattenBookmarks(bookmarkTree);

      expect(flattened).toHaveLength(0);
    });

    it('should preserve dateAdded and dateGroupModified', () => {
      const dateAdded = 1234567890000;
      const dateGroupModified = 1234567890001;

      const bookmarkTree: chrome.bookmarks.BookmarkNode[] = [
        {
          id: '1',
          title: 'Bookmark 1',
          url: 'https://example.com',
          dateAdded,
          dateGroupModified,
        },
      ] as any;

      const flattened = flattenBookmarks(bookmarkTree);

      expect(flattened[0].dateAdded).toBe(dateAdded);
      expect(flattened[0].dateGroupModified).toBe(dateGroupModified);
    });
  });

  describe('syncAllBookmarksToNotion', () => {
    const mockBookmarkTree = [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          {
            id: '2',
            title: 'Folder 1',
            children: [
              {
                id: '3',
                title: 'Bookmark 1',
                url: 'https://example1.com',
                dateAdded: 1234567890000,
              },
              {
                id: '4',
                title: 'Bookmark 2',
                url: 'https://example2.com',
                dateAdded: 1234567890001,
              },
            ],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[];

    it('should sync bookmarks successfully for pro user', async () => {
      mockChrome.bookmarks.getTree.mockResolvedValue(mockBookmarkTree);
      mockChrome.storage.local.get.mockResolvedValue({ is_pro: true });
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { serverAPI } = await import('./server-api');
      vi.mocked(serverAPI.syncBookmarks).mockResolvedValue({
        success: true,
        summary: {
          total: 2,
          created: 2,
          skipped: 0,
        },
      });

      const result = await syncAllBookmarksToNotion();

      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        last_bulk_sync: expect.any(String),
        last_sync_results: expect.objectContaining({
          total: 2,
        }),
        sync_in_progress: false,
      });
    });

    it('should sync bookmarks for free user within limit', async () => {
      mockChrome.bookmarks.getTree.mockResolvedValue(mockBookmarkTree);
      mockChrome.storage.local.get.mockResolvedValue({ is_pro: false });
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { serverAPI } = await import('./server-api');
      vi.mocked(serverAPI.syncBookmarks).mockResolvedValue({
        success: true,
        summary: {
          total: 2,
          created: 2,
          skipped: 0,
        },
      });

      const result = await syncAllBookmarksToNotion();

      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
    });

    it('should throw error when no bookmarks found', async () => {
      const emptyBookmarkTree = [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [],
        },
      ];

      mockChrome.bookmarks.getTree.mockResolvedValue(emptyBookmarkTree);

      await expect(syncAllBookmarksToNotion()).rejects.toThrow('No bookmarks found to sync');
    });

    it('should handle generic errors', async () => {
      mockChrome.bookmarks.getTree.mockResolvedValue(mockBookmarkTree);
      mockChrome.storage.local.get.mockResolvedValue({ is_pro: true });
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { serverAPI } = await import('./server-api');
      vi.mocked(serverAPI.syncBookmarks).mockRejectedValue(new Error('Network error'));

      await expect(syncAllBookmarksToNotion()).rejects.toThrow('Network error');
    });

    it('should store sync metadata on success', async () => {
      mockChrome.bookmarks.getTree.mockResolvedValue(mockBookmarkTree);
      mockChrome.storage.local.get.mockResolvedValue({ is_pro: true });
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { serverAPI } = await import('./server-api');
      vi.mocked(serverAPI.syncBookmarks).mockResolvedValue({
        success: true,
        summary: { total: 2, created: 2, skipped: 0 },
      });

      await syncAllBookmarksToNotion();

      expect(mockChrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          last_bulk_sync: expect.any(String),
          last_sync_results: expect.objectContaining({
            total: 2,
          }),
          sync_in_progress: false,
        })
      );
    });

    it('should generate stable Chrome bookmark identities', async () => {
      mockChrome.bookmarks.getTree.mockResolvedValue(mockBookmarkTree);
      mockChrome.storage.local.get.mockResolvedValue({ is_pro: true });
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { serverAPI } = await import('./server-api');
      vi.mocked(serverAPI.syncBookmarks).mockResolvedValue({
        success: true,
        summary: { total: 2, created: 2, skipped: 0 },
      });

      await syncAllBookmarksToNotion();

      const callArgs = vi.mocked(serverAPI.syncBookmarks).mock.calls[0][0];
      expect(callArgs[0]).toMatchObject({
        syncId: 'chrome-bookmark-3',
        source: 'chrome_bookmark',
      });
    });
  });
});
