import { KeyRound, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OrganizeScope } from '../../core';
import type { LocalBookmark, LocalBookmarkFolder } from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import { useLibraryOrganize, type OrganizePanelError } from '../hook/useLibraryOrganize';
import { OrganizePreviewList } from './OrganizePreviewList';
import { SelectMenu, type SelectMenuOption } from './SelectMenu';

const PROVIDERS: SelectMenuOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'groq', label: 'Groq' },
  { value: 'minimax', label: 'MiniMax' },
];

type Translate = ReturnType<typeof createTranslator>['t'];

function errorMessage(t: Translate, code: OrganizePanelError): string {
  const keys: Record<OrganizePanelError, string> = {
    apply_failed: 'organize_error_apply',
    undo_failed: 'organize_error_undo',
    key_delete_failed: 'organize_error_key_delete',
    invalid_request: 'organize_error_generic',
    not_configured: 'organize_error_not_configured',
    permission_required: 'organize_error_permission',
    invalid_api_key: 'organize_error_invalid_key',
    insufficient_quota: 'organize_error_quota',
    model_access: 'organize_error_model',
    rate_limited: 'organize_error_rate_limited',
    service_unavailable: 'organize_error_unavailable',
    provider_request_failed: 'organize_error_generic',
    invalid_provider_response: 'organize_error_response',
    invalid_response: 'organize_error_response',
  };
  return t(keys[code]);
}

export function OrganizePanel({
  scope,
  bookmarks,
  folders,
  onClose,
}: {
  scope: OrganizeScope;
  bookmarks: LocalBookmark[];
  folders: LocalBookmarkFolder[];
  onClose: () => void;
}) {
  const { t, locale } = createTranslator();
  const titleId = useId();
  const library = useMemo(() => ({ bookmarks, folders }), [bookmarks, folders]);
  const organize = useLibraryOrganize(scope, locale, library);
  const busy = organize.phase === 'running' || organize.phase === 'applying' || organize.undoing;
  const bookmarksById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks]
  );
  const folderPathById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.path])),
    [folders]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ui-ink/35 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-library-line bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-library-line px-5 py-3.5">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-library-forest" />
          <h2 id={titleId} className="flex-1 text-base font-semibold text-library-ink">
            {t('organize_title')}
          </h2>
          <button
            type="button"
            className="library-icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('organize_close')}
            title={t('organize_close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-library-ink">
          {organize.errorCode ? (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-ui-danger-border bg-ui-danger-soft px-3 py-2 text-xs text-ui-danger"
            >
              {errorMessage(t, organize.errorCode)}
            </p>
          ) : null}
          {organize.undoResult ? (
            <p role="status" className="mb-3 rounded-lg bg-library-canvas px-3 py-2 text-xs">
              {t('organize_undo_result', [
                String(organize.undoResult.restored),
                String(organize.undoResult.skipped),
              ])}
            </p>
          ) : null}
          {organize.phase === 'loading' ? (
            <div className="h-24 animate-pulse rounded-lg bg-library-canvas" aria-busy="true" />
          ) : organize.phase === 'setup' ? (
            <KeySetup
              defaultProvider={organize.key?.provider}
              onSave={organize.saveKey}
              onCancel={organize.key ? organize.backToReady : undefined}
            />
          ) : organize.phase === 'ready' ? (
            <ReadyStep organize={organize} scope={scope} />
          ) : organize.phase === 'running' ? (
            <div role="status" className="space-y-3">
              <p>
                {t('organize_progress', [
                  String(organize.progress.completed),
                  String(organize.progress.total),
                ])}
              </p>
              <progress
                className="h-1.5 w-full accent-library-forest"
                max={organize.progress.total || 1}
                value={organize.progress.completed}
              />
            </div>
          ) : organize.phase === 'done' && organize.result ? (
            <p role="status">
              {t('organize_apply_result', [
                String(organize.result.moved),
                String(organize.result.skipped),
              ])}
            </p>
          ) : (
            <PreviewStep
              organize={organize}
              barPath={folders.find((folder) => folder.parentId === '0')?.path ?? ''}
              bookmarksById={bookmarksById}
              folderPathById={folderPathById}
            />
          )}
        </div>
        <Footer organize={organize} scope={scope} onClose={onClose} />
      </div>
    </div>,
    document.body
  );
}

type OrganizeController = ReturnType<typeof useLibraryOrganize>;

function KeySetup({
  defaultProvider,
  onSave,
  onCancel,
}: {
  defaultProvider?: string;
  onSave: (provider: string, apiKey: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = createTranslator();
  const [provider, setProvider] = useState(defaultProvider ?? 'openai');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    // onSave requests the host permission synchronously inside this click.
    void onSave(provider, apiKey).finally(() => setSaving(false));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-library-muted">{t('organize_privacy_note')}</p>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">{t('ai_provider_label')}</span>
        <SelectMenu
          value={provider}
          options={PROVIDERS}
          onChange={setProvider}
          ariaLabel={t('ai_provider_label')}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">{t('organize_key_label')}</span>
        <input
          type="password"
          autoComplete="off"
          className="library-input w-full"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="library-primary-button"
        disabled={saving || !apiKey.trim()}
        onClick={save}
      >
        <KeyRound aria-hidden="true" className="h-4 w-4" />
        {saving ? t('organize_key_saving') : t('organize_key_save')}
      </button>
      {onCancel ? (
        <button
          type="button"
          className="library-secondary-button ml-2"
          disabled={saving}
          onClick={onCancel}
        >
          {t('action_cancel')}
        </button>
      ) : null}
    </div>
  );
}

function ReadyStep({ organize, scope }: { organize: OrganizeController; scope: OrganizeScope }) {
  const { t } = createTranslator();
  const provider = PROVIDERS.find((option) => option.value === organize.key?.provider)?.label;
  const truncated = scope.totalCandidates - scope.excludedCount > scope.items.length;

  return (
    <div className="space-y-3">
      <p>{t('organize_scope_count', [String(scope.items.length)])}</p>
      {truncated ? (
        <p className="text-xs text-library-muted">
          {t('organize_scope_truncated', [String(scope.totalCandidates)])}
        </p>
      ) : null}
      {scope.excludedCount ? (
        <p className="text-xs text-library-muted">
          {t('organize_scope_excluded', [String(scope.excludedCount)])}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-library-muted">{t('organize_taxonomy_note')}</p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-library-canvas px-3 py-2 text-xs">
        <KeyRound aria-hidden="true" className="h-3.5 w-3.5 text-library-muted" />
        <span className="flex-1">
          {t('organize_key_summary', [provider ?? '', organize.key?.last4 ?? ''])}
        </span>
        <button type="button" className="library-secondary-button" onClick={organize.changeKey}>
          {t('organize_key_change')}
        </button>
        <button
          type="button"
          className="library-secondary-button"
          onClick={() => void organize.clearKey()}
        >
          {t('organize_key_clear')}
        </button>
      </div>
    </div>
  );
}

function PreviewStep({
  organize,
  barPath,
  bookmarksById,
  folderPathById,
}: {
  organize: OrganizeController;
  barPath: string;
  bookmarksById: Map<string, LocalBookmark>;
  folderPathById: Map<string, string>;
}) {
  const { t } = createTranslator();
  if (!organize.proposals.length) {
    return <p role="status">{t('organize_preview_empty')}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-library-muted">
          {t('organize_preview_summary', [String(organize.proposals.length)])}
        </p>
        <button
          type="button"
          className="library-secondary-button"
          onClick={() => organize.selectAll(true)}
        >
          {t('organize_select_all')}
        </button>
        <button
          type="button"
          className="library-secondary-button"
          onClick={() => organize.selectAll(false)}
        >
          {t('organize_select_none')}
        </button>
      </div>
      <OrganizePreviewList
        proposals={organize.proposals}
        targets={organize.targetOptions(barPath)}
        bookmarksById={bookmarksById}
        folderPathById={folderPathById}
        onChange={organize.updateProposal}
      />
    </div>
  );
}

function Footer({
  organize,
  scope,
  onClose,
}: {
  organize: OrganizeController;
  scope: OrganizeScope;
  onClose: () => void;
}) {
  const { t } = createTranslator();
  const selectedCount = organize.proposals.filter((proposal) => proposal.selected).length;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-library-line px-5 py-3">
      {organize.canUndo && organize.phase !== 'running' && organize.phase !== 'applying' ? (
        <button
          type="button"
          className="library-secondary-button mr-auto"
          disabled={organize.undoing}
          onClick={() => void organize.undo()}
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
          {t('organize_undo')}
        </button>
      ) : null}
      {organize.phase === 'running' ? (
        <button type="button" className="library-secondary-button" onClick={organize.cancel}>
          {t('action_cancel')}
        </button>
      ) : null}
      {organize.phase === 'ready' ? (
        <button
          type="button"
          className="library-primary-button"
          disabled={!scope.items.length}
          onClick={() => void organize.start()}
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('organize_start')}
        </button>
      ) : null}
      {organize.phase === 'preview' && organize.failedBatches.length ? (
        <button
          type="button"
          className="library-secondary-button"
          onClick={() => void organize.retryFailed()}
        >
          {t('organize_retry_failed', [String(organize.failedBatches.length)])}
        </button>
      ) : null}
      {organize.phase === 'preview' || organize.phase === 'applying' ? (
        <button
          type="button"
          className="library-primary-button"
          disabled={organize.phase === 'applying' || organize.undoing || !selectedCount}
          onClick={() => void organize.apply()}
        >
          {t('organize_apply', [String(selectedCount)])}
        </button>
      ) : null}
      {organize.phase === 'done' || organize.phase === 'setup' ? (
        <button type="button" className="library-secondary-button" onClick={onClose}>
          {t('organize_close')}
        </button>
      ) : null}
    </footer>
  );
}
