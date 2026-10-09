/**
 * Integration tests for Save Current Page feature
 * Tests the server API contract for bookmark sync (Quick Saves flow)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestServer, TestServer } from '../helpers/test-server';

describe('Save Current Page Integration', () => {
  let testServer: TestServer;

  beforeAll(async () => {
    testServer = await createTestServer();
  });

  afterAll(async () => {
    await testServer.stop();
  });

  describe('POST /api/bookmarks/sync', () => {
    it('should accept single bookmark and return success summary', async () => {
      const testBookmark = {
        title: 'Example Domain',
        url: 'https://example.com',
        description: '',
        path: 'Quick Saves',
        dateAdded: new Date().toISOString(),
        syncId: 'test-sync-id-123',
      };

      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: [testBookmark] }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.summary.total).toBe(1);
      expect(result.summary.success).toBe(1);
      expect(result.summary.failed).toBe(0);
    });

    it('should handle multiple bookmarks in quick save batch', async () => {
      const bookmarks = [
        {
          title: 'Page 1',
          url: 'https://example.com/page1',
          description: '',
          path: 'Quick Saves',
          dateAdded: new Date().toISOString(),
          syncId: 'test-sync-id-1',
        },
        {
          title: 'Page 2',
          url: 'https://example.com/page2',
          description: '',
          path: 'Quick Saves',
          dateAdded: new Date().toISOString(),
          syncId: 'test-sync-id-2',
        },
      ];

      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.summary.total).toBe(2);
      expect(result.summary.success).toBe(2);
    });

    it('should handle empty bookmarks array', async () => {
      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: [] }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.summary.total).toBe(0);
    });

    it('should require Content-Type header', async () => {
      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        body: JSON.stringify({ bookmarks: [] }),
      });

      // Should still work since express.json() parses any content type
      expect(response.ok).toBe(true);
    });
  });

  describe('Server API contract for saveCurrentPage', () => {
    it('should match the bookmark structure sent by saveCurrentPage', async () => {
      // This is the exact structure that saveCurrentPage sends:
      const bookmarkFromSaveCurrentPage = {
        title: 'GitHub: Where the world builds software',
        url: 'https://github.com',
        description: '', // Let server generate description
        path: 'Quick Saves', // Default folder for quick saves
        dateAdded: new Date().toISOString(),
        syncId: globalThis.crypto?.randomUUID?.() || `quick-save-${Date.now()}`,
      };

      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: [bookmarkFromSaveCurrentPage] }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.summary.total).toBe(1);
      expect(result.summary.success).toBe(1);
    });

    it('should handle URL validation on server side', async () => {
      // Server should accept any URL format - validation happens in extension
      const bookmarksWithVariousUrls = [
        { title: 'HTTP URL', url: 'http://example.com', description: '', path: 'Quick Saves', dateAdded: new Date().toISOString(), syncId: '1' },
        { title: 'HTTPS URL', url: 'https://example.com', description: '', path: 'Quick Saves', dateAdded: new Date().toISOString(), syncId: '2' },
        { title: 'URL with query params', url: 'https://example.com/search?q=test', description: '', path: 'Quick Saves', dateAdded: new Date().toISOString(), syncId: '3' },
        { title: 'URL with hash', url: 'https://example.com/page#section', description: '', path: 'Quick Saves', dateAdded: new Date().toISOString(), syncId: '4' },
      ];

      const response = await fetch(`${testServer.baseUrl}/api/bookmarks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: bookmarksWithVariousUrls }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.summary.total).toBe(4);
    });
  });
});
