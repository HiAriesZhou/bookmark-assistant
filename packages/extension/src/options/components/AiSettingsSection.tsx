import {
  CircleAlert,
  CircleCheck,
  History,
  LoaderCircle,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { serverAPI, type AiCredentialSummary } from '../../background/server-api';
import { Switch } from '../../components/ui/switch';
import { createTranslator } from '../../utils/i18n';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import {
  aiCredentialIdentityLine,
  type AiSettingsProvider as Provider,
} from './ai-settings-provider';
import { ProBadge, SettingsGroup, SettingsRow } from './Workspace';

type Translate = ReturnType<typeof createTranslator>['t'];

// Chrome i18n has no plural rules, so one/other keys are chosen here.
function countLabel(t: Translate, count: number, one: string, other: string) {
  return count === 1 ? t(one) : t(other, [String(count)]);
}

type RecentTask = {
  id: string;
  status: string;
  reasonCode?: string | null;
  mode: string;
  createdAt: string;
};

function processingReason(t: Translate, reasonCode?: string | null): string | undefined {
  const labels: Record<string, string> = {
    // Historical tasks may still contain this retired reason code.
    skipped_excluded_source: t('ai_reason_source_unavailable'),
    skipped_fetch_disallowed: t('ai_reason_fetch_disallowed'),
    skipped_unsupported_content_type: t('ai_reason_unsupported_type'),
    skipped_insufficient_content: t('ai_reason_insufficient_content'),
    skipped_user_modified: t('ai_reason_user_modified'),
    needs_action_notion_authorization: t('ai_reason_reconnect_notion'),
    needs_action_notion_schema: t('ai_reason_notion_schema'),
    needs_action_credential_deleted: t('ai_reason_add_key'),
    needs_action_invalid_api_key: t('ai_reason_replace_key'),
    needs_action_insufficient_quota: t('ai_reason_quota'),
    needs_action_model_access: t('ai_reason_model_access'),
    failed_provider_request: t('ai_reason_provider_failed'),
    failed_invalid_output: t('ai_reason_invalid_output'),
    failed_notion_write: t('ai_reason_notion_write'),
    service_provider_paused: t('ai_reason_provider_paused'),
  };
  return reasonCode ? labels[reasonCode] || reasonCode.replace(/_/g, ' ') : undefined;
}

type BatchSummary = {
  ready: number;
  retryable: number;
  scheduled: number;
  processing: number;
  blocked: number;
};

export function AiSettingsSection({
  onUpgrade,
  active = true,
}: {
  onUpgrade: () => void;
  active?: boolean;
}) {
  const { t } = createTranslator();
  const { show } = useToast();
  const isConnected = useAppStore((state) => state.isConnected);
  const isPro = useAppStore((state) => state.capabilities?.batchAi ?? state.isPro);
  const deploymentMode = useAppStore((state) => state.deploymentMode);
  const [loading, setLoading] = useState(true);
  const [savingCredential, setSavingCredential] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [credential, setCredential] = useState<AiCredentialSummary>();
  const [providerModels, setProviderModels] = useState<Partial<Record<Provider, string>>>({});
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  // Base URL stays hidden until detection fails or a saved key already uses one.
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlVisible, setBaseUrlVisible] = useState(false);
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary>();
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; remaining: number }>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [recent, setRecent] = useState<RecentTask[]>([]);
  const pendingRequest = useRef(0);
  const lastEnrichmentRefresh = useRef('');
  const settingsBusy = loading || savingSettings || savingCredential;

  useEffect(() => {
    let mounted = true;
    if (!isConnected) {
      setLoading(false);
      setApiKey('');
      setApiKeyError('');
      setCredential(undefined);
      setBaseUrl('');
      setBaseUrlVisible(false);
      setProviderModels({});
      setBatchEnabled(false);
      pendingRequest.current += 1;
      lastEnrichmentRefresh.current = '';
      setBatchSummary(undefined);
      setPendingError(false);
      setHistoryOpen(false);
      setHistoryLoaded(false);
      setRecent([]);
      return () => {
        mounted = false;
      };
    }

    setLoading(true);
    void (async () => {
      const [settingsResult, credentialResult] = await Promise.allSettled([
        serverAPI.getAiSettings(),
        serverAPI.getAiCredential(),
      ]);
      if (!mounted) return;

      let nextBatchEnabled = false;
      if (settingsResult.status === 'fulfilled') {
        const settings = settingsResult.value.settings;
        if (settings) {
          nextBatchEnabled = settings.batchEnabled;
          setBatchEnabled(nextBatchEnabled);
        }
      }
      if (credentialResult.status === 'fulfilled') {
        setProviderModels(credentialResult.value.providerModels || {});
        const savedCredential = credentialResult.value.credential;
        if (savedCredential) {
          setCredential(savedCredential);
          setBaseUrl(savedCredential.baseUrl || '');
          setBaseUrlVisible(Boolean(savedCredential.baseUrl));
        }
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [isConnected]);

  const refreshPendingSummary = useCallback(async () => {
    const request = ++pendingRequest.current;
    setPendingLoading(true);
    setPendingError(false);
    try {
      const result = await serverAPI.getPendingAiSummary();
      if (request !== pendingRequest.current) return;
      setBatchSummary({
        ready: result.ready ?? result.pending,
        retryable: result.retryable ?? 0,
        scheduled: result.scheduled ?? 0,
        processing: result.processing ?? 0,
        blocked: result.blocked ?? 0,
      });
    } catch {
      if (request !== pendingRequest.current) return;
      setPendingError(true);
    } finally {
      if (request === pendingRequest.current) setPendingLoading(false);
    }
  }, []);

  const syncEnrichment = useAppStore((state) => state.syncEnrichment);
  useEffect(() => {
    if (!active || !isConnected || !batchEnabled || loading) return;
    const completedEnrichment =
      syncEnrichment?.status === 'completed' ? syncEnrichment.updatedAt : '';
    const refreshKey = completedEnrichment || 'batch-enabled';
    if (lastEnrichmentRefresh.current === refreshKey) return;
    lastEnrichmentRefresh.current = refreshKey;
    void refreshPendingSummary();
  }, [active, batchEnabled, isConnected, loading, refreshPendingSummary, syncEnrichment]);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const result = await serverAPI.getRecentAiProcessing();
      setRecent((result.tasks || []).slice(0, 5));
      setHistoryLoaded(true);
    } catch (error) {
      show({
        variant: 'error',
        title: error instanceof Error ? error.message : t('ai_error_history'),
      });
    } finally {
      setHistoryLoading(false);
    }
  }

  async function persistSettings(nextBatchEnabled = batchEnabled) {
    await serverAPI.saveAiSettings({
      singlePageEnabled: true,
      batchEnabled: nextBatchEnabled,
    });
  }

  function showSavedBaseUrl(saved: AiCredentialSummary | undefined) {
    setBaseUrl(saved?.baseUrl || '');
    setBaseUrlVisible(Boolean(saved?.baseUrl));
  }

  async function saveApiKey() {
    const nextKey = apiKey.trim();
    const nextBaseUrl = baseUrlVisible ? baseUrl.trim() : '';
    if (!nextKey || savingCredential) return;
    setApiKeyError('');
    setSavingCredential(true);
    try {
      // The server detects the provider from the key; Base URL is only an optional retry hint.
      const result = await serverAPI.saveAiCredential(
        nextBaseUrl ? { apiKey: nextKey, baseUrl: nextBaseUrl } : { apiKey: nextKey }
      );
      setCredential(result.credential);
      showSavedBaseUrl(result.credential);
      setApiKey('');
      await persistSettings();
      if (batchEnabled && active) void refreshPendingSummary();
      show({ variant: 'success', title: t('ai_toast_key_verified') });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'provider_not_detected') {
        setBaseUrlVisible(true);
        setApiKeyError(t('ai_key_not_detected'));
      } else if (code === 'invalid_base_url') {
        setApiKeyError(t('ai_base_url_invalid'));
      } else {
        setApiKeyError(error instanceof Error ? error.message : t('ai_error_key_save'));
      }
    } finally {
      setSavingCredential(false);
    }
  }

  async function toggleBatch(nextValue: boolean) {
    if (!isPro) {
      onUpgrade();
      return;
    }
    const previousValue = batchEnabled;
    setBatchEnabled(nextValue);
    setSavingSettings(true);
    if (!nextValue) {
      pendingRequest.current += 1;
      setBatchSummary(undefined);
      setPendingError(false);
      lastEnrichmentRefresh.current = '';
      setHistoryOpen(false);
    }
    try {
      await persistSettings(nextValue);
    } catch (error) {
      setBatchEnabled(previousValue);
      show({
        variant: 'error',
        title: error instanceof Error ? error.message : t('ai_error_batch_save'),
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function removeApiKey() {
    setSavingCredential(true);
    setApiKeyError('');
    try {
      await serverAPI.deleteAiCredential();
      setCredential(undefined);
      showSavedBaseUrl(undefined);
      setApiKey('');
      show({ variant: 'success', title: t('ai_toast_key_removed') });
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : t('ai_error_key_remove'));
    } finally {
      setSavingCredential(false);
    }
  }

  async function runPendingBatch() {
    const initialPending = (batchSummary?.ready || 0) + (batchSummary?.retryable || 0);
    setRunningBatch(true);
    setBatchProgress({ completed: 0, remaining: initialPending });
    try {
      let processed = 0;
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      let needsAction = 0;
      let remaining = initialPending;
      let confirmedBatches = 0;
      for (let pass = 0; pass < 25; pass += 1) {
        const result = await serverAPI.runPendingAi();
        processed += result.processed;
        succeeded += result.succeeded;
        skipped += result.skipped;
        failed += result.failed;
        needsAction += result.needsAction;
        remaining = result.remaining;
        confirmedBatches += result.confirmedBatches;
        setBatchProgress({ completed: processed, remaining });
        if (!result.processed || !result.remaining) break;
      }
      await refreshPendingSummary();
      if (historyOpen) await refreshHistory();
      if (succeeded) {
        show({
          variant: 'success',
          title: countLabel(t, succeeded, 'ai_toast_generated_one', 'ai_toast_generated_other'),
          description: remaining ? t('ai_toast_remaining', [String(remaining)]) : undefined,
        });
      } else if (processed) {
        const outcome = skipped
          ? t('ai_outcome_skipped')
          : needsAction
            ? t('ai_outcome_needs_action')
            : failed
              ? t('ai_outcome_failed')
              : t('ai_outcome_none');
        show({ variant: 'error', title: outcome });
      } else if (confirmedBatches) {
        show({ variant: 'success', title: t('ai_toast_batch_queued') });
      } else {
        show({ variant: 'info', title: t('ai_toast_no_pending') });
      }
    } catch (error) {
      show({
        variant: 'error',
        title: error instanceof Error ? error.message : t('ai_error_batch_run'),
      });
    } finally {
      setRunningBatch(false);
      setBatchProgress(undefined);
    }
  }

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && !historyLoaded) void refreshHistory();
  };

  const hasCredentialDraft = Boolean(apiKey.trim());
  const hasVerifiedKey = credential?.status === 'verified' && !hasCredentialDraft;
  const detectedModel = credential
    ? credential.model || providerModels[credential.provider] || t('ai_model_managed_default')
    : undefined;
  const readyCount = batchSummary?.ready || 0;
  const retryableCount = batchSummary?.retryable || 0;
  const scheduledCount = batchSummary?.scheduled || 0;
  const canRunBatch = hasVerifiedKey && readyCount + retryableCount > 0;
  const pendingChecking = pendingLoading || (!batchSummary && !pendingError);
  const batchStatus = runningBatch
    ? t('ai_batch_progress', [
        String(batchProgress?.completed || 0),
        String(batchProgress?.remaining || 0),
      ])
    : pendingChecking
      ? t('ai_batch_checking')
      : pendingError
        ? t('ai_batch_check_failed')
        : hasCredentialDraft
          ? t('ai_batch_save_first')
          : !hasVerifiedKey
            ? t('ai_batch_needs_key')
            : readyCount && retryableCount
              ? t('ai_batch_ready_retry', [String(readyCount), String(retryableCount)])
              : readyCount
                ? countLabel(t, readyCount, 'ai_batch_ready_one', 'ai_batch_ready_other')
                : retryableCount
                  ? countLabel(t, retryableCount, 'ai_batch_retry_one', 'ai_batch_retry_other')
                  : scheduledCount
                    ? countLabel(
                        t,
                        scheduledCount,
                        'ai_batch_scheduled_one',
                        'ai_batch_scheduled_other'
                      )
                    : batchSummary?.processing
                      ? countLabel(
                          t,
                          batchSummary.processing,
                          'ai_batch_processing_one',
                          'ai_batch_processing_other'
                        )
                      : batchSummary?.blocked
                        ? countLabel(
                            t,
                            batchSummary.blocked,
                            'ai_batch_blocked_one',
                            'ai_batch_blocked_other'
                          )
                        : t('ai_batch_none');

  const keyStatus = apiKeyError ? (
    <span className="inline-flex items-center gap-1.5 text-ui-danger">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" />
      {apiKeyError}
    </span>
  ) : hasVerifiedKey ? (
    <span className="inline-flex items-center gap-1.5">
      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ui-success" />
      {t('ai_key_verified', [credential?.keyLastFour || ''])}
    </span>
  ) : hasCredentialDraft ? (
    t('ai_key_draft')
  ) : credential ? (
    t('ai_key_replace')
  ) : (
    t('ai_key_privacy_hint')
  );

  const serviceStatus =
    credential?.status === 'verified' ? (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ui-success" />
        {t('ai_service_ready')}
      </span>
    ) : credential ? (
      t('ai_key_replace')
    ) : (
      t('ai_service_not_configured')
    );

  return (
    <SettingsGroup id="ai" title="AI">
      <SettingsRow
        label={t('ai_service_label')}
        description={serviceStatus}
        control={
          credential ? (
            <div className="min-w-0 px-3">
              <p className="truncate text-sm font-medium text-ui-ink">{detectedModel}</p>
              <p className="truncate text-xs text-ui-subtle">
                {aiCredentialIdentityLine(credential)}
              </p>
            </div>
          ) : (
            <p className="truncate px-3 text-xs text-ui-subtle">{t('ai_service_auto_detect')}</p>
          )
        }
      />

      <SettingsRow
        label={t('ai_api_key_label')}
        htmlFor="ai-api-key"
        description={
          <span id="ai-key-status" aria-live="polite">
            {keyStatus}
          </span>
        }
        control={
          <div className="flex gap-2">
            <input
              id="ai-api-key"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setApiKeyError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveApiKey();
                }
              }}
              type="password"
              autoComplete="off"
              disabled={loading || savingCredential || !isConnected}
              placeholder={
                hasVerifiedKey ? t('ai_key_placeholder_replace') : t('ai_key_placeholder')
              }
              aria-describedby="ai-key-status"
              aria-invalid={Boolean(apiKeyError)}
              className="library-input min-w-0 flex-1"
            />
            {hasVerifiedKey && !apiKey.trim() ? (
              <button
                type="button"
                disabled={savingCredential}
                onClick={() => void removeApiKey()}
                className="library-icon-button h-9 w-9 shrink-0 border border-ui-line bg-white hover:bg-ui-danger-soft hover:text-ui-danger"
                title={t('ai_key_remove')}
                aria-label={t('ai_key_remove')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void saveApiKey()}
                disabled={!apiKey.trim() || loading || savingCredential || !isConnected}
                aria-label={savingCredential ? t('ai_key_verifying') : t('ai_key_save')}
                title={savingCredential ? t('ai_key_verifying') : t('ai_key_save')}
                className="library-icon-button h-9 w-9 shrink-0 border border-ui-line bg-white enabled:border-library-ink enabled:bg-library-ink enabled:text-white enabled:hover:bg-ui-control-hover"
              >
                {savingCredential ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        }
      />

      {baseUrlVisible ? (
        <SettingsRow
          label={t('ai_base_url_label')}
          htmlFor="ai-base-url"
          description={t('ai_base_url_hint')}
          control={
            <input
              id="ai-base-url"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setApiKeyError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveApiKey();
                }
              }}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={loading || savingCredential || !isConnected}
              placeholder="https://api.example.com/v1"
              className="library-input w-full min-w-0"
            />
          }
        />
      ) : null}

      <SettingsRow
        label={t('ai_batch_label')}
        badge={
          isPro || deploymentMode === 'self-hosted' ? undefined : <ProBadge onClick={onUpgrade} />
        }
        controlAlign="end"
        control={
          <Switch
            checked={isPro && batchEnabled}
            onCheckedChange={(value) => void toggleBatch(value)}
            disabled={!isPro || settingsBusy || !isConnected}
            aria-label={t('ai_batch_label')}
          />
        }
      />

      {batchEnabled ? (
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-ui-body">{batchStatus}</p>
              <button
                type="button"
                onClick={toggleHistory}
                aria-expanded={historyOpen}
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-ui-subtle hover:text-ui-body"
              >
                <History className="h-3.5 w-3.5" />
                {t('ai_history')}
              </button>
            </div>
            {pendingChecking ? (
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-ui-subtle" />
            ) : pendingError ? (
              <button
                type="button"
                onClick={() => void refreshPendingSummary()}
                aria-label={t('ai_batch_retry_check')}
                title={t('ai_batch_retry_check')}
                className="library-icon-button h-9 w-9 shrink-0 border border-ui-line bg-white"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : canRunBatch || runningBatch ? (
              <button
                type="button"
                onClick={() => void runPendingBatch()}
                disabled={settingsBusy || runningBatch || !canRunBatch}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-library-ink px-3 text-xs font-medium text-white hover:bg-ui-control-hover disabled:bg-ui-control-disabled disabled:text-ui-disabled"
              >
                {runningBatch ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {!readyCount && retryableCount ? t('ai_batch_retry') : t('ai_batch_generate')}
              </button>
            ) : null}
          </div>

          {historyOpen ? (
            <div className="mt-3">
              {historyLoading ? (
                <div className="flex h-16 items-center justify-center">
                  <LoaderCircle className="h-4 w-4 animate-spin text-ui-subtle" />
                </div>
              ) : recent.length ? (
                <ul className="divide-y divide-ui-line">
                  {recent.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <span className="capitalize text-ui-body">{task.mode.replace('_', ' ')}</span>
                      <span className="text-right">
                        <span className="block font-medium text-ui-ink">
                          {task.status.replace(/_/g, ' ')}
                        </span>
                        {processingReason(t, task.reasonCode) ? (
                          <span className="mt-0.5 block text-ui-subtle">
                            {processingReason(t, task.reasonCode)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-xs text-ui-subtle">{t('ai_history_empty')}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  );
}
