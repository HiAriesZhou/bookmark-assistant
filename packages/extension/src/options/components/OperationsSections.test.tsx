import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '../../dashboard/types';
import { SyncStatusSection } from './OperationsSections';

const dashboard = {
  generatedAt: '2026-09-05T00:00:00.000Z',
  connection: { status: 'connected' },
  sync: {
    inProgress: false,
    lastResult: 'success',
    autoSyncEnabled: false,
    failedCount: 0,
  },
  recentActivity: [],
} as unknown as DashboardSnapshot;

describe('sync status', () => {
  beforeEach(() => {
    globalThis.chrome = {
      i18n: {
        getUILanguage: () => 'en',
        getMessage: (key: string) => {
          const messages: Record<string, string> = {
            dashboard_sync_status: 'Sync status',
            sync_status_items_synced: 'Items synced to Notion',
            sync_progress_preparing_sources: 'Bookmarks and Reading List are being prepared',
          };
          return messages[key] || key;
        },
      },
    } as unknown as typeof chrome;
  });

  it('shows only actual work during a sync', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        dashboard={{ ...dashboard, sync: { ...dashboard.sync, inProgress: true } }}
        connectionStatus="connected"
      />
    );

    expect(html).toContain('syncing');
    expect(html).toContain('Bookmarks and Reading List are being prepared');
  });

  it('keeps a partial failure visible instead of reporting success', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        connectionStatus="connected"
        dashboard={{
          ...dashboard,
          sync: { ...dashboard.sync, lastResult: 'partial_failure', failedCount: 1 },
        }}
      />
    );
    expect(html).toContain('dashboard_result_partial_failure');
    expect(html).not.toContain('Items synced to Notion');
  });

  it('reports a successful sync', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection connectionStatus="connected" dashboard={dashboard} />
    );
    expect(html).toContain('Items synced to Notion');
  });
});
