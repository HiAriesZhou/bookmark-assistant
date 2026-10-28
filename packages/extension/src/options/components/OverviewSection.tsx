import { isStaleDestinationStateError } from '../../utils/destination-state';
import { useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { deriveConnectionStatus, showsSyncStatus } from '../connection-view-model';
import { disconnectNotionDestination } from '../destination-actions';
import { createDestinationSummary } from '../destination-view-model';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { DestinationSummary } from './DestinationSummary';
import { NotionConnectPanel } from './NotionConnectPanel';
import { SyncStatusSection } from './OperationsSections';

export function OverviewSection() {
  const { t } = createTranslator();
  const { show } = useToast();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const {
    dashboard,
    isConnected: hasActiveConnection,
    isSyncing,
    hydrationState,
    refreshDashboard,
    syncNow,
  } = useAppStore();
  const connection = dashboard?.connection;
  const status = deriveConnectionStatus(
    hasActiveConnection,
    connection?.status,
    hydrationState !== 'booting'
  );
  const destination = createDestinationSummary(dashboard, status);

  const handleSync = async () => {
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

  const handleDisconnect = async () => {
    try {
      await disconnectNotionDestination(refreshDashboard);
      setShowDisconnectConfirm(false);
      show({
        variant: 'success',
        title: t('disconnected_title'),
        description: t('disconnected_desc'),
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

  return (
    <>
      <DestinationSummary
        destination={destination}
        isBusy={isSyncing}
        onSync={() => void handleSync()}
        onDisconnect={() => setShowDisconnectConfirm(true)}
      />
      {status === 'disconnected' || status === 'degraded' ? (
        <NotionConnectPanel
          onConnected={() => {
            show({
              variant: 'success',
              title: t('connected'),
              description: t('connection_success_desc'),
            });
            void refreshDashboard(true);
          }}
          onError={(message) =>
            show({ variant: 'error', title: t('connection_failed_title'), description: message })
          }
        />
      ) : null}
      {showsSyncStatus(status) ? (
        <SyncStatusSection dashboard={dashboard} connectionStatus={status} />
      ) : null}
      <div className="sr-only" aria-live="polite">
        {isSyncing ? t('syncing') : ''}
      </div>

      <ConfirmDialog
        open={showDisconnectConfirm}
        title={t('confirm_disconnect_title')}
        description={t('confirm_disconnect_message')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('action_cancel')}
        onCancel={() => setShowDisconnectConfirm(false)}
        onConfirm={() => void handleDisconnect()}
      />
    </>
  );
}
