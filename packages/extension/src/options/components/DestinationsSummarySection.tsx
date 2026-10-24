import { createTranslator } from '../../utils/i18n';
import { deriveConnectionStatus } from '../connection-view-model';
import { createDestinationSummary } from '../destination-view-model';
import { useAppStore } from '../store';
import { SettingsGroup, SettingsRow } from './Workspace';

/** Read-only destination status; connection details stay on the Destinations page. */
export function DestinationsSummarySection({
  onOpenDestinations,
}: {
  onOpenDestinations: () => void;
}) {
  const { t } = createTranslator();
  const { dashboard, isConnected, hydrationState } = useAppStore();
  const status = deriveConnectionStatus(
    isConnected,
    dashboard?.connection.status,
    hydrationState !== 'booting'
  );
  const destination = createDestinationSummary(dashboard, status);
  const connected = status === 'connected';
  const statusLabel = connected
    ? t('dashboard_connection_connected')
    : status === 'checking'
      ? t('dashboard_connection_checking')
      : t('dashboard_connection_disconnected');

  return (
    <SettingsGroup id="destinations-summary" title={t('nav_destinations')}>
      <SettingsRow
        label={destination.provider.displayName}
        description={
          connected
            ? `${statusLabel} · ${destination.workspaceName || t('dashboard_workspace_fallback')}`
            : statusLabel
        }
        controlAlign="end"
        control={
          <button
            type="button"
            onClick={onOpenDestinations}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-ink"
          >
            {t('settings_destinations_manage')}
          </button>
        }
      />
    </SettingsGroup>
  );
}
