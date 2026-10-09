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

describe('post-sync enrichment feedback', () => {
  beforeEach(() => {
    globalThis.chrome = {
      i18n: {
        getUILanguage: () => 'en',
        getMessage: (key: string, substitutions?: string | string[]) => {
          const values = Array.isArray(substitutions) ? substitutions : [substitutions || ''];
          const messages: Record<string, string> = {
            dashboard_sync_status: 'Sync status',
            sync_enrichment_processing: 'Adding descriptions in the background…',
            sync_enrichment_ai_ready: `${values[0]} items are ready for batch AI`,
            sync_enrichment_completed: `Descriptions checked for ${values[0]} items`,
            sync_status_items_synced: 'Items synced to Notion',
            sync_progress_preparing_sources: 'Bookmarks and Reading List are being prepared',
            sync_progress_label: 'Sync progress',
            sync_progress_stage_sync: 'Sync',
            sync_progress_stage_descriptions: 'Descriptions',
            sync_progress_stage_ai: 'AI',
            sync_progress_state_complete: 'Completed',
            sync_progress_state_active: 'In progress',
            sync_progress_state_ready: 'Ready',
            sync_progress_state_retrying: 'Retrying',
            sync_progress_state_error: 'Needs attention',
            sync_progress_state_waiting: 'Waiting',
            sync_progress_run_ai: 'Run AI',
            sync_progress_run_ai_title: 'Open AI settings to run pending items',
          };
          return messages[key] || key;
        },
      },
    } as unknown as typeof chrome;
  });

  it('shows enrichment without putting the base sync back into progress', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        dashboard={dashboard}
        connectionStatus="connected"
        enrichment={{
          status: 'processing',
          total: 171,
          updatedAt: '2026-09-05T00:00:01.000Z',
        }}
      />
    );
    expect(html).toContain('Items synced to Notion');
    expect(html).toContain('Adding descriptions in the background…');
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain('Run AI');
    expect(html).not.toContain('syncing');
  });

  it('describes planned AI as ready rather than generating', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        dashboard={dashboard}
        connectionStatus="connected"
        enrichment={{
          status: 'completed',
          total: 171,
          updatedAt: '2026-09-05T00:01:00.000Z',
          aiPlanning: { status: 'planned', taskCount: 42 },
        }}
      />
    );
    expect(html).toContain('42 items are ready for batch AI');
    expect(html).toContain('Descriptions checked for 171 items');
    expect(html).toContain('href="#/settings"');
    expect(html).toContain('Run AI');
    expect(html).not.toContain('generating');
  });

  it('shows only actual work during base sync, without waiting stages', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        dashboard={{ ...dashboard, sync: { ...dashboard.sync, inProgress: true } }}
        connectionStatus="connected"
      />
    );

    expect(html).toContain('syncing');
    expect(html).not.toContain('Waiting');
    expect(html).toContain('Bookmarks and Reading List are being prepared');
  });

  it('does not present previous AI tasks as part of a new sync', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        dashboard={{ ...dashboard, sync: { ...dashboard.sync, inProgress: true } }}
        connectionStatus="connected"
        enrichment={{
          status: 'completed',
          total: 10,
          updatedAt: '2026-09-05T00:01:00.000Z',
          aiPlanning: { status: 'planned', taskCount: 10 },
        }}
      />
    );

    expect(html).not.toContain('ready for batch AI');
    expect(html).not.toContain('Run AI');
  });

  it('keeps a partial base failure visible while descriptions continue', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        connectionStatus="connected"
        dashboard={{
          ...dashboard,
          sync: { ...dashboard.sync, lastResult: 'partial_failure', failedCount: 1 },
        }}
        enrichment={{ status: 'processing', total: 10, updatedAt: '2026-09-05T00:01:00.000Z' }}
      />
    );
    expect(html).toContain('dashboard_result_partial_failure');
    expect(html).toContain('Adding descriptions in the background');
    expect(html).not.toContain('Items synced to Notion');
  });

  it('keeps base success when AI planning fails and offers settings', () => {
    const html = renderToStaticMarkup(
      <SyncStatusSection
        connectionStatus="connected"
        dashboard={dashboard}
        enrichment={{
          status: 'completed',
          total: 10,
          updatedAt: '2026-09-05T00:01:00.000Z',
          aiPlanning: { status: 'failed' },
        }}
      />
    );
    expect(html).toContain('Items synced to Notion');
    expect(html).toContain('AI: Needs attention');
    expect(html).toContain('href="#/settings"');
    expect(html).not.toContain('Run AI');
  });
});
