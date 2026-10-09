/**
 * Unit Tests: Bookmark Formatting Logic
 * Tests the conversion of Chrome bookmarks to server format
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock';

// Setup Chrome mock before any imports that might use it
setupChromeMock();

// Now safe to import modules that depend on chrome global
import { buildBookmarkPath } from '../../packages/extension/src/background/sync';

// Mock bookmark tree structure
const mockBookmarkTree: chrome.bookmarks.BookmarkTreeNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          {
            id: '2',
            title: 'GitHub',
            url: 'https://github.com',
            dateAdded: 1234567890000,
          },
          {
            id: '3',
            title: 'Work',
            children: [
              {
                id: '4',
                title: 'Gmail',
                url: 'https://mail.google.com',
                dateAdded: 1234567891000,
              },
            ],
          },
        ],
      },
      {
        id: '5',
        title: 'Other Bookmarks',
        children: [
          {
            id: '6',
            title: 'Reddit',
            url: 'https://reddit.com',
            dateAdded: 1234567892000,
          },
        ],
      },
    ],
  },
];

describe('Bookmark Formatting', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  describe('buildBookmarkPath', () => {
    it('should build correct folder paths for nested bookmarks', () => {
      const path = buildBookmarkPath(mockBookmarkTree, '4');
      expect(path).toBe('Bookmarks Bar / Work');
    });

    it('should build path for top-level bookmarks', () => {
      const path = buildBookmarkPath(mockBookmarkTree, '2');
      expect(path).toBe('Bookmarks Bar');
    });

    it('should build path for bookmarks in other folders', () => {
      const path = buildBookmarkPath(mockBookmarkTree, '6');
      expect(path).toBe('Other Bookmarks');
    });

    it('should return default path for non-existent bookmarks', () => {
      const path = buildBookmarkPath(mockBookmarkTree, 'non-existent');
      expect(path).toBe('Bookmarks');
    });

    it('should handle empty bookmark tree', () => {
      const path = buildBookmarkPath([], '1');
      expect(path).toBe('Bookmarks');
    });

    it('should filter out empty titles from path', () => {
      const treeWithEmptyTitles: chrome.bookmarks.BookmarkTreeNode[] = [
        {
          id: '0',
          title: '',
          children: [
            {
              id: '1',
              title: '',
              children: [
                {
                  id: '2',
                  title: 'ValidFolder',
                  children: [
                    {
                      id: '3',
                      title: 'Test',
                      url: 'https://test.com',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];
      const path = buildBookmarkPath(treeWithEmptyTitles, '3');
      expect(path).toBe('ValidFolder');
    });
  });
});
