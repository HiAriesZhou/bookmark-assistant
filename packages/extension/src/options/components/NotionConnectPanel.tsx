import { useEffect, useId, useState } from 'react';
import { NOTION_RECONNECT_NOTICE_KEY } from '../../utils/destination-state';
import { createTranslator } from '../../utils/i18n';
import {
  useNotionConnection,
  type NotionTargetChoice,
  type NotionTargets,
} from '../hook/useNotionConnection';
import { WorkspaceSection } from './Workspace';

const TOKEN_GUIDE_URL = 'https://developers.notion.com/guides/get-started/personal-access-tokens';

/**
 * Connects Notion with a token the user creates: check the token, choose a database or a
 * page for a new one, then connect. The token is sent only to the background.
 */
export function NotionConnectPanel({
  onConnected,
  onError,
}: {
  onConnected: () => void;
  onError: (message: string) => void;
}) {
  const { t } = createTranslator();
  const tokenId = useId();
  const { busy, listTargets, connect } = useNotionConnection();
  const [token, setToken] = useState('');
  const [targets, setTargets] = useState<NotionTargets | null>(null);
  const [choice, setChoice] = useState<NotionTargetChoice | null>(null);
  const [reconnect, setReconnect] = useState(false);

  // Set by startup cleanup for users who connected Notion through the retired service.
  useEffect(() => {
    let active = true;
    const readNotice = async () => {
      try {
        const stored = await chrome.storage.local.get(NOTION_RECONNECT_NOTICE_KEY);
        if (active) setReconnect(stored[NOTION_RECONNECT_NOTICE_KEY] === true);
      } catch {
        // Without the notice the form still works.
      }
    };
    void readNotice();
    return () => {
      active = false;
    };
  }, []);

  const reportError = (error: unknown) =>
    onError(error instanceof Error ? error.message : String(error));

  const checkToken = async () => {
    try {
      const found = await listTargets(token.trim());
      setTargets(found);
      const first = found.databases[0] ?? found.pages[0];
      setChoice(first ? { kind: found.databases[0] ? 'database' : 'page', id: first.id } : null);
    } catch (error) {
      setTargets(null);
      reportError(error);
    }
  };

  const finish = async () => {
    if (!choice) return;
    try {
      await connect(token.trim(), choice);
      setToken('');
      setTargets(null);
      onConnected();
    } catch (error) {
      reportError(error);
    }
  };

  const option = (kind: NotionTargetChoice['kind'], id: string, title: string) => (
    <label
      key={`${kind}:${id}`}
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ui-body hover:bg-ui-surface-hover"
    >
      <input
        type="radio"
        name="notion-target"
        className="h-3.5 w-3.5 shrink-0 accent-library-forest"
        checked={choice?.kind === kind && choice.id === id}
        onChange={() => setChoice({ kind, id })}
        disabled={busy}
      />
      <span className="truncate">{title || t('notion_untitled')}</span>
    </label>
  );

  return (
    <WorkspaceSection className="border-t border-ui-line">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void (targets ? finish() : checkToken());
        }}
      >
        {reconnect ? (
          <p role="note" className="text-sm leading-6 text-ui-body">
            {t('notion_reconnect_notice')}
          </p>
        ) : null}
        <label htmlFor={tokenId} className="text-sm font-medium text-ui-ink">
          {t('notion_token_label')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={tokenId}
            data-notion-token-input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="library-input sm:flex-1"
            value={token}
            disabled={busy}
            onChange={(event) => {
              setToken(event.target.value);
              setTargets(null);
            }}
          />
          {targets ? null : (
            <button
              type="submit"
              className="library-primary-button"
              disabled={busy || !token.trim()}
            >
              {busy ? t('loading') : t('notion_token_continue')}
            </button>
          )}
        </div>
        <p className="text-xs leading-5 text-ui-subtle">
          {t('notion_token_help')}{' '}
          <a
            href={TOKEN_GUIDE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ui-ink hover:underline"
          >
            {t('notion_token_guide_link')}
          </a>
        </p>

        {targets ? (
          <div className="flex flex-col gap-3 border-t border-ui-line pt-3">
            <p className="text-sm font-medium text-ui-ink">{t('notion_target_title')}</p>
            {targets.databases.length === 0 && targets.pages.length === 0 ? (
              <p role="note" className="text-xs leading-5 text-ui-subtle">
                {t('notion_target_none')}
              </p>
            ) : null}
            {targets.databases.length > 0 ? (
              <fieldset className="min-w-0">
                <legend className="mb-1 text-xs text-ui-subtle">
                  {t('notion_target_existing')}
                </legend>
                <div className="max-h-48 overflow-y-auto">
                  {targets.databases.map((database) =>
                    option('database', database.id, database.title)
                  )}
                </div>
              </fieldset>
            ) : null}
            {targets.pages.length > 0 ? (
              <fieldset className="min-w-0">
                <legend className="mb-1 text-xs text-ui-subtle">{t('notion_target_new')}</legend>
                <div className="max-h-48 overflow-y-auto">
                  {targets.pages.map((page) => option('page', page.id, page.title))}
                </div>
              </fieldset>
            ) : null}
            <div>
              <button type="submit" className="library-primary-button" disabled={busy || !choice}>
                {busy ? t('connecting') : t('notion_connect_action')}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </WorkspaceSection>
  );
}
