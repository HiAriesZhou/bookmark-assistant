import { CheckCircle2, Circle, CircleAlert, Clock3, LoaderCircle, Sparkles } from 'lucide-react';
import type {
  DashboardConnectionStatus,
  DashboardSnapshot,
  SyncEnrichmentStatus,
} from '../../dashboard/types';
import { relativeTime } from '../../utils/common';
import { createTranslator } from '../../utils/i18n';
import { StatusTransition } from './StatusTransition';
import { WorkspaceSection } from './Workspace';

export function SyncStatusSection({
  dashboard,
  connectionStatus,
  enrichment: enrichmentOverride,
}: {
  dashboard?: DashboardSnapshot;
  connectionStatus: DashboardConnectionStatus;
  enrichment?: SyncEnrichmentStatus;
}) {
  const { t, locale } = createTranslator();
  const sync = dashboard?.sync;
  const connected = connectionStatus === 'connected';
  const enrichment = enrichmentOverride || sync?.enrichment;
  const active = sync?.inProgress;
  const failed =
    Boolean(sync?.failedCount) ||
    ['failed', 'partial_failure', 'limited'].includes(sync?.lastResult || '');
  const completed = sync?.lastResult === 'success' || sync?.lastResult === 'no_changes';
  const statusText = active
    ? t('syncing')
    : !connected
      ? t('sync_status_connect_destination')
      : failed
        ? t(
            `dashboard_result_${sync?.lastResult && sync.lastResult !== 'success' && sync.lastResult !== 'no_changes' ? sync.lastResult : 'failed'}`
          )
        : sync?.lastResult === 'no_changes'
          ? t('sync_status_up_to_date')
          : completed
            ? t('sync_status_items_synced')
            : sync?.lastResult
              ? t(`dashboard_result_${sync.lastResult}`)
              : t('dashboard_no_sync');
  const StatusIcon = active
    ? LoaderCircle
    : failed || !connected
      ? CircleAlert
      : completed
        ? CheckCircle2
        : Circle;
  const descriptionActive = enrichment?.status === 'pending' || enrichment?.status === 'processing';
  const descriptionRetrying = enrichment?.status === 'retrying';
  const DescriptionIcon = descriptionActive
    ? LoaderCircle
    : descriptionRetrying
      ? Clock3
      : CheckCircle2;
  const descriptionText = descriptionActive
    ? t('sync_enrichment_processing')
    : descriptionRetrying
      ? t('sync_enrichment_retrying')
      : enrichment?.status === 'completed'
        ? t('sync_enrichment_completed', [String(enrichment.total)])
        : undefined;
  const aiReady =
    enrichment?.status === 'completed' &&
    enrichment.aiPlanning?.status === 'planned' &&
    (enrichment.aiPlanning.taskCount || 0) > 0;
  const aiFailed = enrichment?.aiPlanning?.status === 'failed';
  const counts = dashboard?.recentActivity.find((event) => event.kind === 'sync_completed')?.counts;
  const countItems =
    counts && !active
      ? [
          [t('dashboard_count_completed'), counts.success],
          [t('dashboard_count_skipped'), counts.skipped],
          [t('dashboard_count_failed'), counts.failed],
        ].filter((item): item is [string, number] => typeof item[1] === 'number')
      : [];

  return (
    <WorkspaceSection className="!py-4">
      <div aria-label={t('dashboard_sync_status')} className="flex items-start gap-2.5">
        <StatusTransition
          state={active ? 'active' : failed ? 'error' : completed ? 'complete' : 'idle'}
          className={`h-7 w-7 shrink-0 rounded-full ${active ? 'bg-ui-muted text-ui-body' : failed ? 'bg-ui-danger-soft text-ui-danger' : completed ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-muted text-ui-subtle'}`}
        >
          <StatusIcon
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${active ? 'animate-spin motion-reduce:animate-none' : ''}`}
          />
        </StatusTransition>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-0.5">
            <p className="text-sm font-semibold text-ui-ink">
              <StatusTransition state={statusText}>{statusText}</StatusTransition>
            </p>
            {countItems.length > 0 ? (
              <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ui-subtle">
                {countItems.map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-1">
                    <dd className="font-medium text-ui-body">{value.toLocaleString()}</dd>
                    <dt>{label}</dt>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          {active ? (
            <p className="text-xs text-ui-subtle">{t('sync_progress_preparing_sources')}</p>
          ) : null}
          {connected && !active && descriptionText ? (
            <div className="flex items-start gap-1.5 text-xs text-ui-subtle">
              <DescriptionIcon
                aria-hidden="true"
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${descriptionActive ? 'animate-spin motion-reduce:animate-none' : ''}`}
              />
              <span>{descriptionText}</span>
            </div>
          ) : null}
          {connected && !active && (aiReady || aiFailed) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ui-subtle">
              <span className="inline-flex items-center gap-1.5">
                {aiFailed ? (
                  <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 text-ui-warning" />
                ) : (
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {aiReady
                  ? t('sync_enrichment_ai_ready', [String(enrichment?.aiPlanning?.taskCount)])
                  : `${t('sync_progress_stage_ai')}: ${t('sync_progress_state_error')}`}
              </span>
              <a
                href="#/settings"
                title={t('sync_progress_run_ai_title')}
                className="inline-flex h-7 items-center rounded-md border border-ui-line px-2 font-medium text-ui-body hover:bg-ui-surface-hover"
              >
                {aiReady ? t('sync_progress_run_ai') : t('nav_settings')}
              </a>
            </div>
          ) : null}
          {sync?.nextAutoSyncAt ? (
            <p className="text-[11px] text-ui-subtle">
              {t('dashboard_next_sync')} · {relativeTime(sync.nextAutoSyncAt, locale)}
            </p>
          ) : null}
        </div>
      </div>
    </WorkspaceSection>
  );
}
