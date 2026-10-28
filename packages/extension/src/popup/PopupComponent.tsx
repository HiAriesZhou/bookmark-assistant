import { isStaleDestinationStateError } from '../utils/destination-state';
import { BookmarkPlus, ChevronRight, Cloud, Library, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import logoUrl from '@product-logo';
import { deriveConnectionStatus } from '../options/connection-view-model';
import { useToast } from '../options/hook/useToast';
import { useAppStore } from '../options/store';
import { relativeTime } from '../utils/common';
import { createTranslator } from '../utils/i18n';
import { saveCurrentPage } from './save-current-page';

type OptionsRoute = 'library' | 'settings';

export default function Popup() {
  const { t, locale } = createTranslator();
  const { show } = useToast();
  const {
    dashboard,
    isConnected: hasActiveConnection,
    isSyncing,
    hydrationState,
    refreshDashboard,
    syncNow,
  } = useAppStore();
  const requestedDashboard = useRef(false);
  const [pageSave, setPageSave] = useState<'idle' | 'saving'>('idle');
  const isBooting = hydrationState === 'booting';
  const connectionStatus = deriveConnectionStatus(
    hasActiveConnection,
    dashboard?.connection.status,
    !isBooting
  );
  const hasDestination = connectionStatus !== 'disconnected';

  useEffect(() => {
    if (hydrationState === 'booting' || requestedDashboard.current) return;
    requestedDashboard.current = true;
    void refreshDashboard(false);
  }, [hydrationState, refreshDashboard]);

  const handleSync = async () => {
    if (!hasDestination || isSyncing) return;
    try {
      const result = await syncNow();
      show({
        variant: result.noChanges ? 'info' : 'success',
        title: result.noChanges
          ? t('dashboard_result_no_changes')
          : t('dashboard_event_sync_completed'),
      });
    } catch (error) {
      if (isStaleDestinationStateError(error)) return;
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSaveCurrentPage = async () => {
    if (!hasDestination || pageSave !== 'idle') return;
    setPageSave('saving');
    try {
      const outcome = await saveCurrentPage();
      if (outcome.status === 'failed') {
        show({ variant: 'error', title: t('saveFailed'), description: outcome.error });
      } else {
        show({ variant: 'success', title: t('saveSuccess') });
      }
    } catch (error) {
      show({
        variant: 'error',
        title: t('saveFailed'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPageSave('idle');
    }
  };

  const openOptionsRoute = (route: OptionsRoute) => {
    const url = chrome.runtime.getURL(`options.html#/${route}`);
    if (chrome.tabs?.create) {
      void chrome.tabs.create({ url });
    } else {
      chrome.runtime.openOptionsPage();
    }
    window.close();
  };

  const destinationName = dashboard?.connection.provider?.displayName || 'Notion';
  const destinationStatus = (() => {
    if (isSyncing) return t('popup_syncing');
    if (dashboard?.connection.status === 'degraded') {
      return dashboard.connection.action === 'reconnect'
        ? t('dashboard_connection_attention')
        : t('popup_destination_unavailable');
    }
    if (dashboard?.sync.lastResult === 'failed') return t('dashboard_result_failed');
    if (dashboard?.sync.lastResult === 'partial_failure') {
      return t('dashboard_result_partial_failure');
    }
    if (!dashboard?.sync.lastSyncAt) return t('dashboard_no_sync');
    return t('popup_synced_at', [relativeTime(dashboard.sync.lastSyncAt, locale)]);
  })();

  return (
    <div className="w-[380px] bg-ui-canvas text-ui-body">
      <header className="flex h-14 items-center gap-2.5 border-b border-ui-line bg-white px-4">
        <img src={logoUrl} alt="" className="h-7 w-7 rounded-md" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em] text-ui-ink">
          {t('popup_title')}
        </h1>
        <button
          type="button"
          onClick={() => openOptionsRoute('settings')}
          aria-label={t('popup_open_settings')}
          title={t('popup_open_settings')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ui-subtle transition-colors hover:bg-ui-surface-hover hover:text-ui-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <main className="space-y-3 p-3">
        {isBooting ? (
          <div
            role="status"
            aria-label={t('dashboard_connection_checking')}
            className="space-y-3 animate-pulse motion-reduce:animate-none"
          >
            <div className="h-[76px] rounded-xl border border-ui-line bg-white shadow-ui-sm" />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openOptionsRoute('library')}
              className="group flex w-full items-center gap-3 rounded-xl border border-ui-line bg-white px-4 py-3.5 text-left shadow-ui-sm transition-colors hover:bg-ui-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-surface-subtle text-ui-ink">
                <Library aria-hidden="true" className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ui-ink">
                  {t('popup_library')}
                </span>
                <span className="mt-0.5 block text-xs text-ui-subtle">
                  {t('popup_bookmark_count', [String(dashboard?.library.bookmarks ?? '—')])}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-ui-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-ui-subtle motion-reduce:transition-none"
              />
            </button>

            {hasDestination ? (
              <section className="flex items-center gap-3 rounded-xl border border-ui-line bg-white px-4 py-3.5 shadow-ui-sm">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-surface-subtle text-ui-ink">
                  <Cloud aria-hidden="true" className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ui-ink">
                      {destinationName}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        dashboard?.connection.status === 'degraded'
                          ? 'bg-ui-warning'
                          : 'bg-ui-success'
                      }`}
                    />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ui-subtle" aria-live="polite">
                    {destinationStatus}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={isSyncing}
                  aria-label={isSyncing ? t('popup_syncing') : t('syncNow')}
                  title={isSyncing ? t('popup_syncing') : t('syncNow')}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ui-control text-white transition-colors hover:bg-ui-control-hover disabled:bg-ui-control-disabled disabled:text-ui-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`h-[18px] w-[18px] ${isSyncing ? 'animate-spin motion-reduce:animate-none' : ''}`}
                  />
                </button>
              </section>
            ) : null}

            {hasDestination ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={handleSaveCurrentPage}
                  disabled={pageSave !== 'idle'}
                  aria-label={t('saveCurrentPage')}
                  aria-busy={pageSave !== 'idle'}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-ui-line bg-white text-sm font-semibold text-ui-ink shadow-ui-sm transition-colors hover:bg-ui-surface-hover disabled:text-ui-disabled disabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus"
                >
                  <BookmarkPlus
                    aria-hidden="true"
                    className={`h-4 w-4 ${pageSave === 'saving' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                  />
                  {t('saveCurrentPage')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
