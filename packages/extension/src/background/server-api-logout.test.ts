import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BULK_SYNC_REQUEST_TIMEOUT_MS,
  SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS,
  serverAPI,
} from './server-api';

describe('ServerAPI - Logout Selective Cleanup', () => {
  let mockChromeStorage: Record<string, any>;

  beforeEach(() => {
    // Mock initial storage state with various keys
    mockChromeStorage = {
      session_token: 'test-token',
      user_id: 'user-123',
      user_email: 'test@example.com',
      is_pro: true,
      purchase_type: 'monthly',
      last_sync: '2025-12-27T10:00:00Z',
      last_sync_summary: 'success',
      last_sync_payload_version: 1,
      sync_in_progress: true,
      sync_started_at: Date.now(),
      sync_trigger: 'manual',
      last_sync_error: 'Old connection failed',
      last_bulk_sync: '2025-12-27T10:00:00Z',
      last_sync_results: { total: 1 },
      last_reading_list_debug: { returnedCount: 0 },
      oauth_template_database_id: 'template-abc-123', // Should be preserved
      bookmark_library_metadata_v1: { schemaVersion: 1, byBookmarkId: {} }, // Should be preserved
      cached_pricing: { monthly: 1.5, yearly: 11.9, schemaVersion: 2 }, // Should be preserved
      auto_sync_enabled: true,
      dashboard_snapshot: { generatedAt: '2025-12-27T10:00:00Z' },
      dashboard_saved_today: { date: '2025-12-27', count: 3 },
    };

    // Mock chrome.storage.local
    global.chrome = {
      runtime: {
        id: 'test-extension-id',
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation((keys) => {
            if (Array.isArray(keys)) {
              const result: Record<string, any> = {};
              keys.forEach((key) => {
                if (key in mockChromeStorage) {
                  result[key] = mockChromeStorage[key];
                }
              });
              return Promise.resolve(result);
            }
            return Promise.resolve(mockChromeStorage);
          }),
          set: vi.fn().mockImplementation((items) => {
            Object.assign(mockChromeStorage, items);
            return Promise.resolve();
          }),
          remove: vi.fn().mockImplementation((keys) => {
            const keysArray = Array.isArray(keys) ? keys : [keys];
            keysArray.forEach((key) => {
              delete mockChromeStorage[key];
            });
            return Promise.resolve();
          }),
          clear: vi.fn().mockImplementation(() => {
            mockChromeStorage = {};
            return Promise.resolve();
          }),
        },
      },
    } as any;

    // Mock fetch for logout API call
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove oauth_template_database_id on logout', async () => {
    await serverAPI.logout();

    // Should be removed
    expect(mockChromeStorage.session_token).toBeUndefined();
    expect(mockChromeStorage.user_id).toBeUndefined();
    expect(mockChromeStorage.user_email).toBeUndefined();
    expect(mockChromeStorage.is_pro).toBeUndefined();
    expect(mockChromeStorage.purchase_type).toBeUndefined();
    expect(mockChromeStorage.last_sync).toBeUndefined();
    expect(mockChromeStorage.auto_sync_enabled).toBeUndefined();
    expect(mockChromeStorage.oauth_template_database_id).toBeUndefined(); // Now removed

    // Should be preserved
    expect(mockChromeStorage.bookmark_library_metadata_v1).toBeDefined();
    expect(mockChromeStorage.cached_pricing).toEqual({
      monthly: 1.5,
      yearly: 11.9,
      schemaVersion: 2,
    });
  });

  it('should remove all authentication-related keys', async () => {
    await serverAPI.logout();

    const authKeys = [
      'session_token',
      'user_id',
      'user_email',
      'is_pro',
      'purchase_type',
      'last_sync',
      'last_sync_at',
      'last_sync_summary',
      'last_sync_count',
      'last_sync_fingerprint',
      'last_sync_payload_version',
      'last_sync_hash',
      'sync_in_progress',
      'sync_started_at',
      'sync_trigger',
      'is_connecting',
      'auto_sync_enabled',
      'auto_sync_interval_minutes',
      'sync_interval_hours',
      'last_reading_list_debug',
      'dashboard_snapshot',
    ];

    authKeys.forEach((key) => {
      expect(mockChromeStorage[key]).toBeUndefined();
    });
  });

  it('preserves local descriptions and tags after account logout', async () => {
    const metadata = {
      schemaVersion: 1,
      byBookmarkId: {
        'bookmark-1': {
          description: 'User summary',
          tags: ['Reference'],
          updatedAt: '2026-10-13T00:00:00.000Z',
        },
      },
    };
    mockChromeStorage.bookmark_library_metadata_v1 = metadata;

    await serverAPI.logout();

    expect(mockChromeStorage.bookmark_library_metadata_v1).toEqual(metadata);
  });

  it('should clear sessionToken in memory', async () => {
    // Set sessionToken
    (serverAPI as any).sessionToken = 'test-token';

    await serverAPI.logout();

    expect((serverAPI as any).sessionToken).toBeNull();
  });

  it("clears a prior connection's sync fingerprint after OAuth succeeds", async () => {
    mockChromeStorage.sync_enrichment_job = { id: 'old-target-job' };
    mockChromeStorage.sync_enrichment_state = { status: 'retrying' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        sessionToken: 'new-session-token',
        userId: 'user-456',
        userEmail: 'new@example.com',
        templateDatabaseId: 'template-new',
      }),
    } as Response);

    await serverAPI.exchangeOAuthCode(
      'oauth-code',
      'https://extension-id.chromiumapp.org/callback'
    );

    expect(mockChromeStorage.session_token).toBe('new-session-token');
    expect(mockChromeStorage.last_sync_fingerprint).toBeUndefined();
    expect(mockChromeStorage.last_sync_count).toBeUndefined();
    expect(mockChromeStorage.last_sync_payload_version).toBeUndefined();
    expect(mockChromeStorage.dashboard_snapshot).toBeUndefined();
    expect(mockChromeStorage.dashboard_saved_today).toBeUndefined();
    expect(mockChromeStorage.sync_in_progress).toBeUndefined();
    expect(mockChromeStorage.sync_enrichment_job).toBeUndefined();
    expect(mockChromeStorage.sync_enrichment_state).toBeUndefined();
    expect(mockChromeStorage.sync_started_at).toBeUndefined();
    expect(mockChromeStorage.sync_trigger).toBeUndefined();
    expect(mockChromeStorage.last_sync_error).toBeUndefined();
    expect(mockChromeStorage.last_bulk_sync).toBeUndefined();
    expect(mockChromeStorage.last_sync_results).toBeUndefined();
  });

  it('clears the local session even when the network is unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(serverAPI.logout()).resolves.not.toThrow();

    // Should still clear local storage
    expect(mockChromeStorage.session_token).toBeUndefined();
    expect(mockChromeStorage.oauth_template_database_id).toBeUndefined(); // Now removed
  });

  it('should send reading list as a separate payload field during sync', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        summary: { total: 2, success: 2, failed: 0 },
        results: [],
      }),
    } as Response);

    await serverAPI.syncBookmarks([
      {
        title: 'Bookmark',
        url: 'https://example.com/bookmark',
        type: 'bookmark',
      },
      {
        title: 'Reading List Item',
        url: 'https://example.com/read-later',
        type: 'reading_list',
        readState: 'UNREAD',
        source: 'reading_list',
      },
    ]);

    const request = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(body.bookmarks).toHaveLength(1);
    expect(body.readingList).toEqual([
      {
        title: 'Reading List Item',
        url: 'https://example.com/read-later',
        type: 'reading_list',
        readState: 'UNREAD',
        source: 'reading_list',
      },
    ]);
    expect(body.items).toHaveLength(2);
    expect(body).not.toHaveProperty('requestTimeoutMs');
  });

  it('sends the base-first flag inside server sync options', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        summary: { total: 1, success: 1, failed: 0 },
        results: [],
      }),
    } as Response);

    await serverAPI.syncBookmarks(
      [{ title: 'Bookmark', url: 'https://example.com', type: 'bookmark' }],
      { deferEnhancements: true }
    );

    const request = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.options).toEqual({ deferEnhancements: true });
    expect(body).not.toHaveProperty('deferEnhancements');
  });

  it('keeps a bulk sync alive past the observed 336 second duration', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    global.fetch = vi.fn().mockImplementation((url, init?: RequestInit) => {
      if (String(url).endsWith('/api/client-log')) {
        return Promise.resolve({ ok: true } as Response);
      }
      requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    });

    const pending = serverAPI.syncBookmarks([
      { title: 'Slow bookmark', url: 'https://example.com/slow', type: 'bookmark' },
    ]);
    const rejected = expect(pending).rejects.toThrow('timed out after 600s');
    await vi.advanceTimersByTimeAsync(0);

    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(336_000);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(BULK_SYNC_REQUEST_TIMEOUT_MS - 336_000);
    expect(requestSignal?.aborted).toBe(true);
    await rejected;
  });

  it('uses the bounded single-item timeout without sending it to the server', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    global.fetch = vi.fn().mockImplementation((url, init?: RequestInit) => {
      if (String(url).endsWith('/api/client-log')) {
        return Promise.resolve({ ok: true } as Response);
      }
      requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    });

    const pending = serverAPI.syncBookmarks(
      [{ title: 'Quick save', url: 'https://example.com/quick', type: 'bookmark' }],
      { aiBatchEligible: false, requestTimeoutMs: SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS }
    );
    const rejected = expect(pending).rejects.toThrow('timed out after 90s');
    await vi.advanceTimersByTimeAsync(0);

    const request = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.aiBatchEligible).toBe(false);
    expect(body).not.toHaveProperty('requestTimeoutMs');

    await vi.advanceTimersByTimeAsync(SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS - 1);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSignal?.aborted).toBe(true);
    await rejected;
  });
});
