import { useEffect, useState } from 'react';
import { isStaleAccountStateError } from '../../utils/account-state';
import { createTranslator } from '../../utils/i18n';
import {
  signInWithGoogleAccount,
  signOutAccount,
  startEmailSignIn,
  verifyEmailSignIn,
} from '../account-actions';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { SettingsGroup, SettingsRow } from './Workspace';

const ACTION_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg bg-ui-ink px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const QUIET_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-ink disabled:cursor-not-allowed disabled:opacity-50';

/** Settings account sign-in. Deletion stays in the service-data section. */
export function AccountSection() {
  const { t, locale } = createTranslator();
  const { show } = useToast();
  const {
    isSignedIn,
    userEmail,
    signInMethods,
    hasGoogleSignIn,
    showPriorNotionHint,
    loadSignInMethods,
    refreshDashboard,
  } = useAppStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailEnabled = signInMethods.includes('email');
  const googleEnabled = signInMethods.includes('google');

  useEffect(() => {
    if (isSignedIn) return;
    void loadSignInMethods();
  }, [isSignedIn, loadSignInMethods]);

  useEffect(() => {
    if (!emailEnabled) setCodeSent(false);
  }, [emailEnabled]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (isStaleAccountStateError(error)) return;
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup id="account" title={t('account_title')}>
      {isSignedIn ? (
        <>
          <SettingsRow
            label={t('account_signed_in_label')}
            description={userEmail || undefined}
            controlAlign="end"
            control={
              <button
                type="button"
                className={QUIET_BUTTON}
                disabled={busy}
                onClick={() => void run(() => signOutAccount(refreshDashboard))}
              >
                {t('account_sign_out')}
              </button>
            }
          />
          {googleEnabled && !hasGoogleSignIn ? (
            <SettingsRow
              label={t('account_link_google')}
              controlAlign="end"
              control={
                <button
                  type="button"
                  className={QUIET_BUTTON}
                  disabled={busy}
                  onClick={() => void run(() => signInWithGoogleAccount())}
                >
                  {t('account_link_google')}
                </button>
              }
            />
          ) : null}
          {showPriorNotionHint ? (
            <p className="px-4 py-3 text-sm leading-6 text-ui-subtle">
              {t('account_prior_notion_hint')}
            </p>
          ) : null}
        </>
      ) : (
        <>
          {emailEnabled ? (
            <>
              <SettingsRow
                label={t('account_email_label')}
                htmlFor="account-email"
                control={
                  <input
                    id="account-email"
                    type="email"
                    autoComplete="email"
                    className="library-input w-full"
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                }
              />
              {codeSent ? (
                <SettingsRow
                  label={t('account_code_label')}
                  htmlFor="account-code"
                  control={
                    <input
                      id="account-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="library-input w-full"
                      value={code}
                      disabled={busy}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  }
                />
              ) : null}
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {codeSent ? (
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    disabled={busy || code.trim().length === 0}
                    onClick={() =>
                      void run(async () => {
                        await verifyEmailSignIn(email.trim(), code.trim());
                      })
                    }
                  >
                    {busy ? t('account_signing_in') : t('account_sign_in')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    disabled={busy || email.trim().length === 0}
                    onClick={() =>
                      void run(async () => {
                        await startEmailSignIn(email.trim(), locale);
                        setCodeSent(true);
                      })
                    }
                  >
                    {t('account_send_code')}
                  </button>
                )}
              </div>
            </>
          ) : null}
          {googleEnabled ? (
            <div className="px-4 py-3">
              <button
                type="button"
                className={QUIET_BUTTON}
                disabled={busy}
                onClick={() => void run(() => signInWithGoogleAccount())}
              >
                {t('account_sign_in_google')}
              </button>
            </div>
          ) : null}
          {!emailEnabled && !googleEnabled ? (
            <p className="px-4 py-3 text-sm leading-6 text-ui-subtle">
              {t('account_signed_out_notion_only')}
            </p>
          ) : null}
        </>
      )}
    </SettingsGroup>
  );
}
