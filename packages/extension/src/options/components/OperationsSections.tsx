import { CheckCircle2, Circle, CircleAlert, LoaderCircle } from 'lucide-react';
import type { DashboardConnectionStatus, DashboardSnapshot } from '../../dashboard/types';
import { relativeTime } from '../../utils/common';
import { createTranslator } from '../../utils/i18n';
import { StatusTransition } from './StatusTransition';
import { WorkspaceSection } from './Workspace';

export function SyncStatusSection({
  dashboard,
  connectionStatus,
}: {
  dashboard?: DashboardSnapshot;
  connectionStatus: DashboardConnectionStatus;
}) {
  const { t, locale } = createTranslator();
  const sync = dashboard?.sync;
  const connected = connectionStatus === 'connected';
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
