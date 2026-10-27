import { useEffect, useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { Switch } from '../../components/ui/switch';
import { useAppStore } from '../store';
import { useToast } from '../hook/useToast';
import { DestinationRequiredNotice, SettingsGroup, SettingsRow } from './Workspace';

/** Scheduled sync for Pro and self-hosted; the settings workspace hides it for hosted Free. */
export function SyncSettingsSection({ onOpenDestinations }: { onOpenDestinations: () => void }) {
  const { t } = createTranslator();
  const { show } = useToast();
  const {
    isPro,
    isConnected,
    capabilities,
    autoSync,
    intervalHours,
    setAutoSync,
    saveSyncSettings,
    getEffectiveLimits,
  } = useAppStore();
  const planAllowsAutoSync = capabilities?.autoSync ?? isPro;
  // Scheduled sync writes to Notion, so the plan alone is not enough.
  const autoSyncAllowed = planAllowsAutoSync && isConnected;
  const [value, setValue] = useState<number>(intervalHours);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const { minIntervalHours } = getEffectiveLimits();

  useEffect(() => setValue(intervalHours), [intervalHours]);

  const onToggleAuto = async () => {
    if (!autoSyncAllowed) return;
    await setAutoSync(!autoSync);
  };

  const onIntervalBlur = async () => {
    setFocused(false);
    if (!Number.isFinite(value) || value < minIntervalHours) {
      setError(t('sync_interval_validation', [String(minIntervalHours)]));
      return;
    }
    setError('');
    try {
      await saveSyncSettings(value);
    } catch (caught) {
      show({
        variant: 'error',
        title: t('error_save_settings_failed'),
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  return (
    <SettingsGroup id="sync" title={t('nav_sync_settings')}>
      <SettingsRow
        label={t('auto_sync_label')}
        controlAlign="end"
        control={
          <Switch
            checked={autoSyncAllowed && autoSync}
            onCheckedChange={onToggleAuto}
            disabled={!autoSyncAllowed}
            aria-label={t('auto_sync_label')}
          />
        }
      />

      {planAllowsAutoSync && !isConnected ? (
        <DestinationRequiredNotice
          message={t('sync_needs_destination')}
          onOpenDestinations={onOpenDestinations}
        />
      ) : null}

      {autoSyncAllowed && autoSync ? (
        <SettingsRow
          label={t('sync_interval_label')}
          htmlFor="sync-interval"
          description={
            <span id="sync-interval-help" className={error ? 'text-ui-danger' : undefined}>
              {error || (focused ? t('sync_interval_min', [String(minIntervalHours)]) : null)}
            </span>
          }
          control={
            <div className="library-input-frame flex h-9 overflow-hidden">
              <input
                id="sync-interval"
                type="number"
                min={minIntervalHours}
                value={value}
                onChange={(event) => setValue(Number(event.target.value))}
                onFocus={() => setFocused(true)}
                onBlur={onIntervalBlur}
                aria-describedby="sync-interval-help"
                aria-invalid={Boolean(error)}
                className="library-inline-input min-w-0 flex-1 px-3 text-xs font-medium"
              />
              <span className="flex items-center border-l border-ui-line bg-ui-surface-subtle px-3 text-xs text-ui-subtle">
                {t('hours_unit')}
              </span>
            </div>
          }
        />
      ) : null}
    </SettingsGroup>
  );
}
