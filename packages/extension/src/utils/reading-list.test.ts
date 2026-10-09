/**
 * Tests for reading list utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getReadingListItems } from './reading-list';

describe('getReadingListItems', () => {
  const mockReadingListItems = [
    {
      title: 'Test Article 1',
      url: 'https://example.com/article-1',
      creationTime: Date.now() - 86400000, // 1 day ago
      hasBeenRead: false,
    },
    {
      title: 'Test Article 2',
      url: 'https://example.com/article-2',
      creationTime: Date.now() - 3600000, // 1 hour ago
      hasBeenRead: true,
    },
  ];

  describe('when chrome.readingList API is available', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', {
        readingList: {
          query: vi.fn().mockResolvedValue(mockReadingListItems),
        },
      });
    });

    it('should return mapped reading list items', async () => {
      const items = await getReadingListItems();

      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        title: 'Test Article 1',
        url: 'https://example.com/article-1',
        path: 'Reading List',
        dateAdded: expect.any(String),
        readState: 'UNREAD',
        syncId: expect.any(String),
        type: 'reading_list',
        source: 'reading_list',
      });
    });

    it('should map readState from hasBeenRead', async () => {
      const items = await getReadingListItems();

      expect(items[0].readState).toBe('UNREAD');
      expect(items[1].readState).toBe('READ');
    });

    it('should generate stable syncId from URL', async () => {
      const items = await getReadingListItems();
      const nextItems = await getReadingListItems();

      expect(items[0].syncId).toMatch(/^reading-list-[0-9a-f]+$/);
      expect(nextItems[0].syncId).toBe(items[0].syncId);
    });

    it('should convert dateAdded to ISO string', async () => {
      const items = await getReadingListItems();

      expect(typeof items[0].dateAdded).toBe('string');
      // Verify it's a valid date string
      expect(() => new Date(items[0].dateAdded)).not.toThrow();
    });

    it('should set type to reading_list', async () => {
      const items = await getReadingListItems();

      expect(items[0].type).toBe('reading_list');
      expect(items[1].type).toBe('reading_list');
    });

    it('should call chrome.readingList.query', async () => {
      await getReadingListItems();

      expect(chrome.readingList.query).toHaveBeenCalledWith({});
      expect(chrome.readingList.query).toHaveBeenCalledTimes(1);
    });

    it('should fall back to explicit read and unread queries when default query is empty', async () => {
      vi.stubGlobal('chrome', {
        readingList: {
          query: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([mockReadingListItems[0]])
            .mockResolvedValueOnce([mockReadingListItems[1]]),
        },
      });

      const items = await getReadingListItems();

      expect(items).toHaveLength(2);
      expect(items[0].readState).toBe('UNREAD');
      expect(items[1].readState).toBe('READ');
      expect(chrome.readingList.query).toHaveBeenCalledWith({});
      expect(chrome.readingList.query).toHaveBeenCalledWith({ hasBeenRead: false });
      expect(chrome.readingList.query).toHaveBeenCalledWith({ hasBeenRead: true });
    });

    it('should fall back to Reading List bookmarks when chrome.readingList queries are empty', async () => {
      vi.stubGlobal('chrome', {
        readingList: {
          query: vi.fn().mockResolvedValue([]),
        },
        bookmarks: {
          getTree: vi.fn().mockResolvedValue([
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
                      title: 'Reading List',
                      children: [
                        {
                          id: '3',
                          title: 'Fallback Article',
                          url: 'https://example.com/fallback',
                          dateAdded: 1700000000000,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ]),
        },
      });

      const items = await getReadingListItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Fallback Article',
        url: 'https://example.com/fallback',
        path: 'Reading List',
        readState: 'UNREAD',
        type: 'reading_list',
        source: 'reading_list',
      });
      expect(chrome.bookmarks.getTree).toHaveBeenCalledTimes(1);
    });

    it('reuses a supplied bookmark tree without querying it again', async () => {
      const getTree = vi.fn();
      vi.stubGlobal('chrome', {
        readingList: { query: vi.fn().mockResolvedValue([]) },
        bookmarks: { getTree },
      });
      const items = await getReadingListItems({
        fallbackBookmarkTree: [
          {
            id: 'root',
            title: '',
            children: [
              {
                id: 'reading-list',
                title: 'Reading List',
                children: [
                  {
                    id: 'item',
                    title: 'Synthetic Article',
                    url: 'https://example.com/synthetic',
                  },
                ],
              },
            ],
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(getTree).not.toHaveBeenCalled();
    });
  });

  describe('when chrome.readingList API is NOT available', () => {
    let warnSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.stubGlobal('chrome', {});
      warnSpy = vi.fn();
      console.warn = warnSpy;
    });

    it('should return empty array', async () => {
      const items = await getReadingListItems();

      expect(items).toEqual([]);
    });

    it('should log warning', async () => {
      await getReadingListItems();

      expect(warnSpy).toHaveBeenCalled();
      const warnCalls = warnSpy.mock.calls;
      const hasExpectedMessage = warnCalls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('API not available')
      );
      expect(hasExpectedMessage).toBe(true);
    });
  });

  describe('when chrome.readingList.query throws error', () => {
    let warnSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.stubGlobal('chrome', {
        readingList: {
          query: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      });
      warnSpy = vi.fn();
      console.warn = warnSpy;
    });

    it('should return empty array', async () => {
      const items = await getReadingListItems();

      expect(items).toEqual([]);
    });

    it('should log warning about error', async () => {
      await getReadingListItems();

      expect(warnSpy).toHaveBeenCalled();
      const warnCalls = warnSpy.mock.calls;
      const hasExpectedMessage = warnCalls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Failed to query readingList API, using bookmark tree fallback')
      );
      expect(hasExpectedMessage).toBe(true);
    });
  });

  describe('when reading list is empty', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', {
        readingList: {
          query: vi.fn().mockResolvedValue([]),
        },
      });
    });

    it('should return empty array', async () => {
      const items = await getReadingListItems();

      expect(items).toEqual([]);
    });
  });
});
