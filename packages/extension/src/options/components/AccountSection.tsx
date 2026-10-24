import { useEffect, useState } from 'react';
import { isStaleAccountStateError } from '../../utils/account-state';
import { createTranslator } from '../../utils/i18n';
import {
  signInWithGoogleAccount,
  signOutAccount,
  startEmailSignIn,
  verifyEmailSignIn,
} from '../account-actions';
import { productConfig } from '../../product-config';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { SettingsGroup, SettingsRow } from './Workspace';

const ACTION_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg bg-ui-ink px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const QUIET_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-ink disabled:cursor-not-allowed disabled:opacity-50';
// Google sign-in branding: white surface, light outline, full-color mark, standard label.
const GOOGLE_BUTTON =
  'inline-flex h-9 w-full items-center justify-center gap-2.5 rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-[#1f1f1f] hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-50';

/** Google's "G" mark, inlined so no external asset is fetched. The mark belongs to Google; see NOTICE. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function useAccountAction() {
  const { t } = createTranslator();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
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
  return { busy, run };
}

/** Signed-in account identity and sign-in methods. Deletion stays in the service-data section. */
export function AccountSection() {
  const { t } = createTranslator();
  const { userEmail, signInMethods, hasGoogleSignIn, showPriorNotionHint, refreshDashboard } =
    useAppStore();
  const { busy, run } = useAccountAction();
  const googleEnabled = signInMethods.includes('google');

  return (
    <SettingsGroup id="account" title={t('account_title')}>
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
    </SettingsGroup>
  );
}

/** Signed-out settings route: the login page and nothing account-scoped. */
export function AccountSignIn() {
  const { t, locale } = createTranslator();
  const { isSignedIn, signInMethods, deploymentMode, commerceEnabled, loadSignInMethods } =
    useAppStore();
  const { busy, run } = useAccountAction();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const emailEnabled = signInMethods.includes('email');
  const googleEnabled = signInMethods.includes('google');
  const offersPro = deploymentMode === 'hosted' && commerceEnabled;

  useEffect(() => {
    if (isSignedIn) return;
    void loadSignInMethods();
  }, [isSignedIn, loadSignInMethods]);

  useEffect(() => {
    if (!emailEnabled) setCodeSent(false);
  }, [emailEnabled]);

  return (
    <section id="account" aria-labelledby="account-title" className="scroll-mt-24 pt-6 sm:pt-10">
      <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
        <h1
          id="account-title"
          className="text-center text-xl font-semibold tracking-[-0.03em] text-library-ink"
        >
          {t('account_login_title', [productConfig.name])}
        </h1>
        {emailEnabled || googleEnabled ? (
          <>
            <p className="text-center text-sm leading-6 text-ui-subtle">
              {t('account_sign_in_intro')}
            </p>
            {googleEnabled ? (
              <button
                type="button"
                className={GOOGLE_BUTTON}
                disabled={busy}
                onClick={() => void run(() => signInWithGoogleAccount())}
              >
                <GoogleMark />
                {t('account_sign_in_google')}
              </button>
            ) : null}
            {googleEnabled && emailEnabled ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                className="flex items-center gap-3 text-xs text-ui-subtle before:h-px before:flex-1 before:bg-ui-line after:h-px after:flex-1 after:bg-ui-line"
              >
                {t('account_or_divider')}
              </div>
            ) : null}
            {emailEnabled ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (codeSent) {
                    void run(async () => {
                      await verifyEmailSignIn(email.trim(), code.trim());
                    });
                    return;
                  }
                  void run(async () => {
                    await startEmailSignIn(email.trim(), locale);
                    setCodeSent(true);
                  });
                }}
              >
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  aria-label={t('account_email_label')}
                  placeholder={t('account_email_label')}
                  className="library-input w-full"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {codeSent ? (
                  <input
                    id="account-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={t('account_code_label')}
                    placeholder={t('account_code_label')}
                    className="library-input w-full"
                    value={code}
                    disabled={busy}
                    onChange={(event) => setCode(event.target.value)}
                  />
                ) : null}
                <button
                  type="submit"
                  className={`${ACTION_BUTTON} w-full`}
                  disabled={busy || (codeSent ? code : email).trim().length === 0}
                >
                  {codeSent
                    ? busy
                      ? t('account_signing_in')
                      : t('account_sign_in')
                    : t('account_send_code')}
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="text-center text-sm leading-6 text-ui-subtle">
            {t('account_signed_out_notion_only')}
          </p>
        )}
        <div className="mt-3 space-y-2 text-center text-xs leading-5 text-ui-subtle">
          <p>{t('account_continue_without_login')}</p>
          {offersPro ? <p>{t('account_login_ai_value')}</p> : null}
        </div>
      </div>
    </section>
  );
}
