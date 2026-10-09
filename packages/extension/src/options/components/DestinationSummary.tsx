import { Link2, LoaderCircle, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DestinationSummaryModel } from '../destination-view-model';
import { relativeTime } from '../../utils/common';
import { createTranslator } from '../../utils/i18n';
import { StatusTransition } from './StatusTransition';
import { WorkspaceSection } from './Workspace';

export function DestinationSummary({
  destination,
  isBusy,
  onAction,
  onDisconnect,
}: {
  destination: DestinationSummaryModel;
  isBusy: boolean;
  onAction: () => void;
  onDisconnect: () => void;
}) {
  const { t, locale } = createTranslator();
  const [menuOpen, setMenuOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const { status } = destination;
  const connected = status === 'connected';
  const checking = status === 'checking';
  const needsAttention = status === 'degraded';
  const statusLabel = connected
    ? t('dashboard_connection_connected')
    : needsAttention
      ? t('dashboard_connection_degraded')
      : checking
        ? t('dashboard_connection_checking')
        : t('dashboard_connection_disconnected');
  const idleActionLabel = connected
    ? t('destination_sync_action')
    : needsAttention
      ? t('dashboard_action_reconnect')
      : t('dashboard_action_connect');
  const actionLabel = isBusy ? (connected ? t('syncing') : t('connecting')) : idleActionLabel;
  const actionState = isBusy
    ? 'busy'
    : connected
      ? 'sync'
      : needsAttention
        ? 'reconnect'
        : 'connect';

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <WorkspaceSection divided={false} className="py-5 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-library-line bg-white font-display text-lg font-semibold text-library-ink">
            N
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-[-0.02em] text-ui-ink">
                {destination.provider.displayName}
              </h2>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-ui-subtle">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${connected ? 'bg-ui-success' : needsAttention ? 'bg-ui-warning' : checking ? 'bg-ui-disabled' : 'bg-ui-danger'}`}
                />
                <StatusTransition state={statusLabel}>{statusLabel}</StatusTransition>
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-ui-subtle">
              {destination.workspaceName ||
                (connected ? t('dashboard_workspace_fallback') : t('destination_not_configured'))}
              {destination.destinationName ? ` · ${destination.destinationName}` : ''}
              {destination.lastSyncAt
                ? ` · ${t('dashboard_last_sync')} ${relativeTime(destination.lastSyncAt, locale)}`
                : ''}
            </p>
          </div>
        </div>

        <div ref={actionsRef} className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onAction}
            disabled={checking || isBusy}
            aria-label={actionLabel}
            aria-busy={isBusy}
            title={actionLabel}
            className={
              connected
                ? 'library-icon-button bg-library-ink text-white hover:bg-ui-control-hover hover:text-white'
                : 'library-primary-button relative'
            }
          >
            {!connected ? (
              <span className="grid place-items-center">
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 inline-flex items-center gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {idleActionLabel}
                </span>
                <StatusTransition state={actionState} className="col-start-1 row-start-1">
                  {isBusy ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <>
                      <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
                      {idleActionLabel}
                    </>
                  )}
                </StatusTransition>
              </span>
            ) : (
              <StatusTransition state={actionState}>
                {isBusy ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
              </StatusTransition>
            )}
          </button>
          {connected || needsAttention ? (
            <div className="relative">
              <button
                type="button"
                aria-label={t('destination_actions')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((value) => !value)}
                className="library-icon-button"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 min-w-36 rounded-[10px] border border-library-line bg-white p-1 shadow-library-popover"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDisconnect();
                    }}
                    className="flex h-9 w-full items-center rounded-md px-3 text-left text-xs text-ui-danger hover:bg-ui-danger-soft"
                  >
                    {t('disconnect')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </WorkspaceSection>
  );
}
