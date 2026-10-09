import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_VERSION } from '../product-version.generated';
import type { DashboardEvent } from '../dashboard/types';
import {
  classifyDashboardError,
  getDashboardSnapshot,
  inferSyncResult,
  keepRecentEvents,
} from './dashboard';
import { serverAPI } from './server-api';

describe('dashboard state helpers', () => {
  it('keeps a bounded, newest-first activity list', () => {
    const events: DashboardEvent[] = [
      { id: 'old', occurredAt: '2026-07-15T08:00:00.000Z', kind: 'sync_started' },
      { id: 'new', occurredAt: '2026-07-15T10:00:00.000Z', kind: 'sync_completed' },
      { id: 'middle', occurredAt: '2026-07-15T09:00:00.000Z', kind: 'save_completed' },
    ];

    expect(keepRecentEvents(events, 2).map((event) => event.id)).toEqual(['new', 'middle']);
  });

  it('stores only a stable error category for activity', () => {
    expect(classifyDashboardError(new Error('Request timed out after 30s'))).toBe('network');
    expect(classifyDashboardError(new Error('429 rate limit'))).toBe('rate_limit');
    expect(classifyDashboardError(new Error('Notion database permission denied'))).toBe(
      'notion_access'
    );
  });

  it('distinguishes partial failures and limits', () => {
    expect(inferSyncResult({ success: 4, failed: 1 }, new Error('item failed'))).toBe(
      'partial_failure'
    );
    expect(inferSyncResult(undefined, new Error('429 rate limit'))).toBe('limited');
    expect(inferSyncResult(undefined, new Error('unknown'))).toBe('failed');
  });

  it('extends the existing snapshot while reading the bookmark tree once', async () => {
    const getTree = vi.fn().mockResolvedValue([
      {
        id: 'root',
        title: '',
        children: [
          {
            id: 'bar',
            parentId: 'root',
            title: 'Bookmarks Bar',
            children: [
              {
                id: 'item',
                parentId: 'bar',
                title: 'Synthetic Item',
                url: 'https://example.com/item',
              },
            ],
          },
        ],
      },
    ]);
    vi.stubGlobal('chrome', {
      bookmarks: { getTree },
      readingList: { query: vi.fn().mockResolvedValue([]) },
      runtime: { getManifest: () => ({ version: PRODUCT_VERSION, permissions: ['readingList'] }) },
      alarms: { get: vi.fn().mockResolvedValue(undefined) },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    const snapshot = await getDashboardSnapshot();

    expect(getTree).toHaveBeenCalledTimes(1);
    expect(snapshot.library.bookmarks).toBe(1);
    expect(snapshot.libraryHealth).toMatchObject({
      version: 1,
      bookmarkCount: 1,
      topLevelUncategorizedCount: 1,
      estimatedLocalSyncItems: 1,
    });
  });

  it('reuses a degraded connection briefly when the server is unavailable', async () => {
    const storage: Record<string, unknown> = { session_token: 'session-one' };
    vi.stubGlobal('chrome', {
      bookmarks: { getTree: vi.fn().mockResolvedValue([]) },
      readingList: { query: vi.fn().mockResolvedValue([]) },
      runtime: { getManifest: () => ({ version: PRODUCT_VERSION, permissions: ['readingList'] }) },
      alarms: { get: vi.fn().mockResolvedValue(undefined) },
      storage: {
        local: {
          get: vi.fn(async () => ({ ...storage })),
          set: vi.fn(async (next: Record<string, unknown>) => Object.assign(storage, next)),
        },
      },
    });
    const profile = vi
      .spyOn(serverAPI, 'getUserProfile')
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const first = await getDashboardSnapshot();
    const second = await getDashboardSnapshot();

    expect(profile).toHaveBeenCalledTimes(1);
    expect(first.connection).toMatchObject({ status: 'degraded', action: 'retry' });
    expect(second.connection).toMatchObject({ status: 'degraded', action: 'retry' });
  });
});
