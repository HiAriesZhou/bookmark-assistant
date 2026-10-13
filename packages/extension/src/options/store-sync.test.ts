import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../utils/message';
import { parseCachedPricing, preserveInMemoryActivity, useAppStore } from './store';
import type { DashboardSnapshot } from '../dashboard/types';

vi.mock('../utils/message', async () => {
  const actual = await vi.importActual<typeof import('../utils/message')>('../utils/message');
  return { ...actual, sendMessage: vi.fn() };
});

const originalRefreshDashboard = useAppStore.getState().refreshDashboard;

describe('manual sync store action', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockReset();
    useAppStore.setState({
      isSyncing: false,
      refreshDashboard: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    useAppStore.setState({
      isSyncing: false,
      refreshDashboard: originalRefreshDashboard,
    });
  });

  it('sets syncing immediately and refreshes the dashboard after success', async () => {
    let finishSync: ((value: { success: true; noChanges: true }) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }) as ReturnType<typeof sendMessage>
    );

    const syncPromise = useAppStore.getState().syncNow();

    expect(useAppStore.getState().isSyncing).toBe(true);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        { type: 'SYNC_ALL_BOOKMARKS', accountRevision: null },
        { timeoutMs: 630_000 }
      )
    );
    finishSync?.({ success: true, noChanges: true });

    await expect(syncPromise).resolves.toEqual({ noChanges: true });
    expect(useAppStore.getState().refreshDashboard).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().isSyncing).toBe(false);
  });

  it('surfaces a background failure and still resets state', async () => {
    vi.mocked(sendMessage).mockResolvedValue({
      success: false,
      error: 'Server rejected sync',
    });

    await expect(useAppStore.getState().syncNow()).rejects.toThrow('Server rejected sync');
    expect(useAppStore.getState().refreshDashboard).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().isSyncing).toBe(false);
  });
});

describe('dashboard snapshot cache updates', () => {
  it('does not let the activity-free popup cache erase fresh Options activity', () => {
    const event = {
      id: 'sync-1',
      occurredAt: '2026-08-19T00:00:00.000Z',
      kind: 'sync_completed' as const,
      result: 'success' as const,
      counts: { success: 2, skipped: 1, failed: 0 },
    };
    const current = {
      generatedAt: '2026-08-19T00:00:00.000Z',
      recentActivity: [event],
    } as DashboardSnapshot;
    const cached = { ...current, recentActivity: [] };

    expect(preserveInMemoryActivity(cached, current).recentActivity).toEqual([event]);
  });

  it('coalesces dashboard refreshes triggered while a request is in flight', async () => {
    vi.mocked(sendMessage).mockReset();
    let finishRefresh: ((value: { success: false; error: string }) => void) | undefined;
    vi.mocked(sendMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }) as ReturnType<typeof sendMessage>
    );
    useAppStore.setState({ refreshDashboard: originalRefreshDashboard });

    const first = useAppStore.getState().refreshDashboard(false);
    const second = useAppStore.getState().refreshDashboard(false);

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    finishRefresh?.({ success: false, error: 'server unavailable' });
    await Promise.all([first, second]);
    expect(useAppStore.getState().isDashboardLoading).toBe(false);
  });
});

describe('pricing cache', () => {
  it('rejects prices cached before the yearly pricing schema', () => {
    expect(parseCachedPricing({ monthly: 2.5, yearly: 30 })).toBeNull();
    expect(parseCachedPricing({ monthly: 1.5, yearly: 11.9, schemaVersion: 2 })).toEqual({
      monthly: 1.5,
      yearly: 11.9,
    });
  });
});
