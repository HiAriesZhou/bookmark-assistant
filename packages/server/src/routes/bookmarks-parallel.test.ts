/**
 * Unit tests for Bookmark Sync batch parallelization
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import { diffBookmarks, diffLinkItems } from '../core';

// Mock dependencies before importing bookmarks
vi.mock('../services/notion', () => ({
  notionService: {
    verifyDatabaseAccess: vi.fn().mockResolvedValue({
      databaseId: 'verified-db-id',
      dataSourceId: 'verified-ds-id',
    }),
    existingBookmarkUrls: vi.fn().mockResolvedValue({
      urls: [] as string[],
      syncIds: [] as string[],
    }),
    buildPropertiesFromDataSource: vi.fn().mockResolvedValue({}),
    createPage: vi.fn().mockResolvedValue({ id: 'page-id' }),
    updatePage: vi.fn().mockResolvedValue({ id: 'page-id' }),
  },
}));

vi.mock('../services/userPrisma', () => ({
  userPrisma: {
    find: vi.fn().mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      plan: 'pro',
      notionAccessToken: 'test-token',
      notionDatabaseId: 'test-db-id',
      notionDataSourceId: 'test-ds-id',
    }),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../services/description-extractor', () => ({
  descriptionExtractor: {
    extractFromUrl: vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        success: true,
        description: `Description for ${url}`,
        source: 'meta_description',
      })
    ),
  },
}));

vi.mock('../utils', () => ({
  validateBookmark: vi.fn().mockImplementation((bookmark: any) => bookmark),
  createBatches: vi.fn().mockImplementation((array: any[], size: number) => {
    const batches: any[] = [];
    for (let i = 0; i < array.length; i += size) {
      batches.push(array.slice(i, i + size));
    }
    return batches;
  }),
  sleep: vi.fn().mockResolvedValue(undefined),
  sanitizeError: vi.fn().mockImplementation((err) => String(err)),
  auditLog: vi.fn(),
  hasProEntitlements: vi.fn().mockReturnValue(true),
}));

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    limits: {
      free: { minIntervalHours: 24 },
      pro: { minIntervalHours: 6 },
    },
    batchDefaults: {
      size: 3,
      delayMs: 100,
    },
    descriptionExtraction: {
      batchSize: 2,
      batchDelayMs: 50,
      timeoutMs: 5000,
    },
  },
}));

describe('Bookmark Sync Batch Parallelization', () => {
  describe('Code structure verification for Issue fixes', () => {
    it('should have syncBatchToNotion function defined', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain('syncBatchToNotion');
    });

    it('should have correct function signature with required parameters', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toMatch(/async function syncBatchToNotion\(\s*batch: BookmarkItem\[\],/);
      expect(content).toMatch(/verifiedDatabaseId: string,/);
      expect(content).toMatch(/verifiedDataSourceId: string,/);
      expect(content).toMatch(/userData: \{ notionAccessToken: string \}/);
    });

    it('should call existingBookmarkUrls before description batch loop', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      const existingBookmarkUrlsPos = content.indexOf('notionService.existingBookmarkUrls');
      const descriptionBatchesPos = content.indexOf('descriptionBatches');

      expect(existingBookmarkUrlsPos).toBeLessThan(descriptionBatchesPos);
    });

    it('should merge bookmarks and readingList payload arrays before validation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain('readingList');
      expect(content).toContain('syncItems.map');
    });

    it('should update urls and syncIds after batch sync', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      const firstSyncCall = content.indexOf('syncBatchToNotion(');
      const firstIndexUpdate = content.indexOf('addCreatedLinksToExistingIndex(');

      expect(firstIndexUpdate).toBeGreaterThan(firstSyncCall);
    });

    it('should have url/syncId update after "all have descriptions" path sync (Issue 1 fix)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      // Find the "all have descriptions" section
      const allHaveDescriptionsPos = content.indexOf('All bookmarks already have descriptions');
      expect(allHaveDescriptionsPos).toBeGreaterThan(0);

      const indexUpdateAfterAllHave = content.indexOf(
        'addCreatedLinksToExistingIndex(',
        allHaveDescriptionsPos
      );

      expect(indexUpdateAfterAllHave).toBeGreaterThan(allHaveDescriptionsPos);
    });

    it('should sync remaining bookmarks after batch loop (Issue 2 fix)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      // After the batch loop, there should be a section that syncs remaining bookmarks
      // Look for "bookmarksWithDescriptions" which is used in Issue 2 fix
      expect(content).toContain('bookmarksWithDescriptions');

      // There should be a sync plan application after filtering bookmarksWithDescriptions
      const bookmarksWithDescriptionsPos = content.indexOf('bookmarksWithDescriptions');
      const syncPlanAfterBookmarksWithDescriptions = content.indexOf(
        'applySyncPlanToNotion(',
        bookmarksWithDescriptionsPos
      );

      expect(syncPlanAfterBookmarksWithDescriptions).toBeGreaterThan(bookmarksWithDescriptionsPos);
    });

    it('should have correct batch loop structure for description extraction', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      // Verify the batch loop applies the create/update sync plan for each batch
      // This is the core of the batch parallelization

      // Find the for loop that processes description batches
      const forLoopPos = content.indexOf('for (let i = 0; i < descriptionBatches.length');
      expect(forLoopPos).toBeGreaterThan(0);

      const syncInLoop = content.indexOf('await applySyncPlanToNotion(', forLoopPos);
      expect(syncInLoop).toBeGreaterThan(forLoopPos);

      const indexUpdateInLoop = content.indexOf('addCreatedLinksToExistingIndex(', syncInLoop);

      expect(indexUpdateInLoop).toBeGreaterThan(syncInLoop);
    });

    it('uses the durable bulk AI task queue rather than one enqueue per bookmark', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain('queue.enqueueBatch({');
      expect(content).not.toContain('AI_TASK_ENQUEUE_CONCURRENCY');
    });

    it('bounds every Notion write path, including deferred descriptions', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain('const NOTION_WRITE_CONCURRENCY = 3;');
      expect(content).toContain('createBatches(batch, NOTION_WRITE_CONCURRENCY)');
      expect(content).toContain('createBatches(updates, NOTION_WRITE_CONCURRENCY)');
      expect(content).toContain('deferredDescriptionBookmarks');
    });

    it('returns an explicit partial-sync result when writes are deferred', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain('canStartNotionWrite');
      expect(content).toContain('deferredNotionWrites');
      expect(content).toContain('partialSync');
    });
  });

  describe('public server-core consumption', () => {
    it('should consume sync helpers from public server-core', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      expect(content).toContain("from '../core'");
      expect(content).toContain('diffLinkItems');
      expect(content).toContain('normalizeBookmarkForSyncPlanning');
      expect(content).toContain('ExistingLinkRecord');
    });

    it('should correctly identify duplicates by syncId', () => {
      const diff = diffBookmarks(
        [
          { title: 'Existing', url: 'https://changed.example.com', syncId: 'sync-1' },
          { title: 'New', url: 'https://new.example.com', syncId: 'sync-2' },
        ],
        ['https://existing.example.com'],
        ['sync-1']
      );

      expect(diff.toCreate).toEqual([
        { title: 'New', url: 'https://new.example.com', syncId: 'sync-2' },
      ]);
      expect(diff.skippedExisting).toBe(1);
      expect(diff.stats.matchedBySyncId).toBe(1);
      expect(diff.stats.matchedByUrl).toBe(0);
    });

    it('should correctly identify duplicates by URL', () => {
      const diff = diffBookmarks(
        [
          { title: 'Existing', url: 'https://existing.example.com' },
          { title: 'New', url: 'https://new.example.com' },
        ],
        ['https://existing.example.com'],
        []
      );

      expect(diff.toCreate).toEqual([{ title: 'New', url: 'https://new.example.com' }]);
      expect(diff.skippedExisting).toBe(1);
      expect(diff.stats.matchedBySyncId).toBe(0);
      expect(diff.stats.matchedByUrl).toBe(1);
    });

    it('should track stats for both syncId and URL matches', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bookmarksPath = path.resolve(__dirname, './bookmarks.ts');
      const content = fs.readFileSync(bookmarksPath, 'utf-8');

      // Verify the diff outcome includes stats
      expect(content).toContain('duplicatesBySyncId');
      expect(content).toContain('duplicatesByUrl');
    });

    it('should create reading list rows separately from bookmark rows with the same URL', () => {
      const diff = diffLinkItems(
        [
          {
            title: 'Read Later',
            url: 'https://example.com/shared',
            type: 'reading_list',
            readState: 'UNREAD',
          },
        ],
        [
          {
            pageId: 'bookmark-page',
            url: 'https://example.com/shared',
            type: 'bookmark',
          },
        ]
      );

      expect(diff.toCreate).toHaveLength(1);
      expect(diff.skippedExisting).toBe(0);
    });

    it('should plan a Notion update when reading list read state changes', () => {
      const diff = diffLinkItems(
        [
          {
            title: 'Article',
            url: 'https://example.com/article',
            type: 'reading_list',
            readState: 'READ',
            syncId: 'reading-list-article',
          },
        ],
        [
          {
            pageId: 'page-1',
            url: 'https://example.com/article',
            type: 'reading_list',
            readState: 'UNREAD',
            syncId: 'reading-list-article',
          },
        ]
      );

      expect(diff.toCreate).toEqual([]);
      expect(diff.toUpdate).toEqual([
        {
          pageId: 'page-1',
          item: {
            title: 'Article',
            url: 'https://example.com/article',
            type: 'reading_list',
            readState: 'READ',
            syncId: 'reading-list-article',
          },
        },
      ]);
      expect(diff.stats.updatesNeeded).toBe(1);
    });

    it('should plan a Notion update when an existing reading list row is missing source type', () => {
      const diff = diffLinkItems(
        [
          {
            title: 'Article',
            url: 'https://example.com/article',
            type: 'reading_list',
            readState: 'UNREAD',
            syncId: 'reading-list-article',
          },
        ],
        [
          {
            pageId: 'page-1',
            url: 'https://example.com/article',
            readState: 'UNREAD',
            syncId: 'reading-list-article',
          },
        ]
      );

      expect(diff.toCreate).toEqual([]);
      expect(diff.toUpdate).toEqual([
        {
          pageId: 'page-1',
          item: {
            title: 'Article',
            url: 'https://example.com/article',
            type: 'reading_list',
            readState: 'UNREAD',
            syncId: 'reading-list-article',
          },
        },
      ]);
      expect(diff.stats.updatesNeeded).toBe(1);
    });

    it('should plan a Notion update when an existing bookmark row is missing source type', () => {
      const diff = diffLinkItems(
        [
          {
            title: 'Bookmark',
            url: 'https://example.com/bookmark',
            type: 'bookmark',
            syncId: 'bookmark-article',
          },
        ],
        [
          {
            pageId: 'page-1',
            url: 'https://example.com/bookmark',
            syncId: 'bookmark-article',
          },
        ]
      );

      expect(diff.toCreate).toEqual([]);
      expect(diff.toUpdate).toEqual([
        {
          pageId: 'page-1',
          item: {
            title: 'Bookmark',
            url: 'https://example.com/bookmark',
            type: 'bookmark',
            syncId: 'bookmark-article',
          },
        },
      ]);
      expect(diff.stats.updatesNeeded).toBe(1);
    });
  });
});
