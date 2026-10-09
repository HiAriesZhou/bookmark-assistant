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
      isPro: true,
      plan: 'pro',
      dashboard: connectedDashboard,
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    });
  });

  afterEach(() => {
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  it('clears remote state and rebuilds the local dashboard after logout', async () => {
    const disconnectedDashboard = {
      ...connectedDashboard,
      connection: { status: 'disconnected', action: 'connect' },
    } as DashboardSnapshot;
    const refreshDashboard = vi.fn(async () => {
      useAppStore.setState({ dashboard: disconnectedDashboard });
    });

    await disconnectNotionDestination(refreshDashboard);

    expect(refreshDashboard).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().isConnected).toBe(false);
    expect(useAppStore.getState().isPro).toBe(false);
    expect(useAppStore.getState().dashboard).toEqual(disconnectedDashboard);
  });
});
