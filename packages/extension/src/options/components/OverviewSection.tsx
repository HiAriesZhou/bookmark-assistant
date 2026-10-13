import { isStaleAccountStateError } from '../../utils/account-state';
import { useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { deriveConnectionStatus, showsSyncStatus } from '../connection-view-model';
import { disconnectNotionDestination } from '../destination-actions';
import { createDestinationSummary } from '../destination-view-model';
import { useNotionConnection } from '../hook/useNotionConnection';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { DestinationSummary } from './DestinationSummary';
import { SyncStatusSection } from './OperationsSections';

export function OverviewSection() {
  const { t } = createTranslator();
  const { show } = useToast();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const {
    dashboard,
    isConnected: hasActiveConnection,
    isSyncing,
    syncEnrichment,
    hydrationState,
    refreshDashboard,
    syncNow,
  } = useAppStore();
  const { connect, isConnecting } = useNotionConnection();
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
      if (isStaleAccountStateError(error)) return;
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleConnectionAction = async () => {
    if (await connect()) await refreshDashboard(true);
  };

  const handleDestinationAction = () => {
    if (status === 'connected') void handleSync();
    else void handleConnectionAction();
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
      if (isStaleAccountStateError(error)) return;
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
        isBusy={isSyncing || isConnecting}
        onAction={handleDestinationAction}
        onDisconnect={() => setShowDisconnectConfirm(true)}
      />
      {showsSyncStatus(status) ? (
        <SyncStatusSection
          dashboard={dashboard}
          connectionStatus={status}
          enrichment={syncEnrichment}
        />
      ) : null}
      <div className="sr-only" aria-live="polite">
        {isSyncing
          ? t('syncing')
          : syncEnrichment?.status === 'pending' || syncEnrichment?.status === 'processing'
            ? t('sync_enrichment_processing')
            : ''}
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
