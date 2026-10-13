import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSnapshot } from '../../dashboard/types';
import { disconnectNotionDestination } from '../destination-actions';
import { useAppStore } from '../store';

const connectedDashboard = {
  generatedAt: '2026-09-10T00:00:00.000Z',
  connection: { status: 'connected', workspaceName: 'Workspace', databaseName: 'Bookmarks' },
  library: { bookmarks: 2, readingList: 0, savedToday: 0, duplicatesSkipped: 0 },
  sync: { inProgress: false, autoSyncEnabled: false, failedCount: 0 },
  recentActivity: [],
} as DashboardSnapshot;

describe('disconnectNotionDestination', () => {
  const originalState = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState({
      ...originalState,
      isConnected: true,
      isSignedIn: true,
      isPro: true,
      plan: 'pro',
      dashboard: connectedDashboard,
    });
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({ session_token: 'account-session' })) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    });
  });

  afterEach(() => {
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  it('unlinks Notion but keeps the account and its plan', async () => {
    const disconnectedDashboard = {
      ...connectedDashboard,
      connection: { status: 'disconnected', action: 'connect' },
    } as DashboardSnapshot;
    const refreshDashboard = vi.fn(async () => {
      useAppStore.setState({ dashboard: disconnectedDashboard });
    });

    await disconnectNotionDestination(refreshDashboard);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'DISCONNECT_NOTION',
      accountRevision: null,
    });
    expect(refreshDashboard).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().isConnected).toBe(false);
    expect(useAppStore.getState().isSignedIn).toBe(true);
    expect(useAppStore.getState().isPro).toBe(true);
    expect(useAppStore.getState().plan).toBe('pro');
    expect(useAppStore.getState().dashboard).toEqual(disconnectedDashboard);
  });

  it('reports a failed disconnect instead of pretending Notion was removed', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false, error: 'offline' });

    await expect(disconnectNotionDestination(vi.fn())).rejects.toThrow('offline');
    expect(useAppStore.getState().isConnected).toBe(true);
  });
});
