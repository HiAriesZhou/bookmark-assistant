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
      autoSync: true,
      dashboard: connectedDashboard,
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            notion_token: 'ntn_test',
            notion_database: { id: 'db-1' },
            destination_revision: 'rev-1',
          })),
        },
      },
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    });
  });

  afterEach(() => {
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  it('forgets the Notion connection and stops scheduled sync locally', async () => {
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
      destinationRevision: 'rev-1',
    });
    expect(refreshDashboard).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().isConnected).toBe(false);
    expect(useAppStore.getState().autoSync).toBe(false);
    expect(useAppStore.getState().dashboard).toEqual(disconnectedDashboard);
  });

  it('reports a failed disconnect instead of pretending Notion was removed', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false, error: 'offline' });

    await expect(disconnectNotionDestination(vi.fn())).rejects.toThrow('offline');
    expect(useAppStore.getState().isConnected).toBe(true);
  });
});
