import { useCallback, useEffect, useState, type ReactNode } from 'react';
import logoUrl from '@product-logo';
import { createTranslator } from '../../utils/i18n';
import { signInWithGoogleAccount, startEmailSignIn, verifyEmailSignIn } from '../account-actions';
import { productConfig } from '../../product-config';
import { useAccountAction } from '../hook/useAccountAction';
import { useAppStore } from '../store';
import { PlanRows, RefreshPlanButton } from './PlanRows';
import { SettingsGroup, SettingsRow } from './Workspace';

const QUIET_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-ink disabled:cursor-not-allowed disabled:opacity-50';
// The login page uses one 40px control height so Google, email and submit line up.
const LOGIN_PRESS = 'transition-transform active:scale-[0.98] disabled:active:scale-100';
const LOGIN_BUTTON = `inline-flex h-10 items-center justify-center rounded-lg bg-ui-ink px-3 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${LOGIN_PRESS}`;
const QUIET_LOGIN_BUTTON = `inline-flex h-10 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-ink ${LOGIN_PRESS}`;
const LOGIN_INPUT = 'library-input h-10 text-sm';
// Google sign-in branding: white surface, light outline, full-color mark, standard label.
const GOOGLE_BUTTON = `inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-[#1f1f1f] hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-50 ${LOGIN_PRESS}`;

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

/**
 * Signed-in account group: the plan with its comparison, plus account linking. Sign-out
 * and deletion sit at the bottom of the page in AccountActions.
 */
export function AccountSection() {
  const { t } = createTranslator();
  const {
    signInMethods,
    hasGoogleSignIn,
    showPriorNotionHint,
    deploymentMode,
    commerceEnabled,
    isPro,
  } = useAppStore();
  const { busy, run } = useAccountAction();
  const googleEnabled = signInMethods.includes('google');
  const hostedCommerce = deploymentMode === 'hosted' && commerceEnabled;
  const planLabel =
    deploymentMode === 'self-hosted'
      ? t('deployment_self_hosted')
      : t(isPro ? 'account_plan_pro' : 'account_plan_free');

  return (
    <SettingsGroup
      id="account"
      title={t('account_title')}
      action={hostedCommerce ? <RefreshPlanButton /> : undefined}
    >
      {hostedCommerce ? <PlanRows /> : <SettingsRow label={planLabel} />}
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

type SignInMethodsState = 'loading' | 'ready' | 'failed';

/** Signed-out settings route: the login page and nothing account-scoped. */
export function AccountSignIn({ onOpenDestinations }: { onOpenDestinations?: () => void }) {
  const { t, locale } = createTranslator();
  const { isSignedIn, signInMethods, deploymentMode, commerceEnabled, loadSignInMethods } =
    useAppStore();
  const { busy, run } = useAccountAction();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [methodsState, setMethodsState] = useState<SignInMethodsState>(() =>
    signInMethods.length > 0 ? 'ready' : 'loading'
  );
  const emailEnabled = signInMethods.includes('email');
  const googleEnabled = signInMethods.includes('google');
  const offersPro = deploymentMode === 'hosted' && commerceEnabled;

  const refreshMethods = useCallback(async () => {
    const loaded = await loadSignInMethods();
    // Cached methods stay usable when a refresh fails; only an empty list needs a retry.
    setMethodsState(loaded || useAppStore.getState().signInMethods.length > 0 ? 'ready' : 'failed');
  }, [loadSignInMethods]);

  useEffect(() => {
    if (isSignedIn) return;
    void refreshMethods();
  }, [isSignedIn, refreshMethods]);

  useEffect(() => {
    if (!emailEnabled) setCodeSent(false);
  }, [emailEnabled]);

  const retry = () => {
    setMethodsState('loading');
    void refreshMethods();
  };

  let methods: ReactNode;
  if (methodsState === 'loading') {
    methods = (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        <div className="h-10 rounded-lg bg-ui-line/70 motion-safe:animate-pulse" />
        <div className="h-10 rounded-lg bg-ui-line/50 motion-safe:animate-pulse" />
      </div>
    );
  } else if (methodsState === 'failed') {
    methods = (
      <>
        <p role="alert" className="text-center text-sm leading-6 text-ui-subtle">
          {t('account_sign_in_methods_failed')}
        </p>
        <button type="button" className={`${QUIET_LOGIN_BUTTON} w-full`} onClick={retry}>
          {t('account_sign_in_methods_retry')}
        </button>
      </>
    );
  } else if (emailEnabled || googleEnabled) {
    methods = (
      <>
        <p className="text-center text-sm leading-6 text-ui-subtle">{t('account_sign_in_intro')}</p>
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
              className={LOGIN_INPUT}
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
                className={LOGIN_INPUT}
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            ) : null}
            <button
              type="submit"
              className={`${LOGIN_BUTTON} w-full`}
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
    );
  } else {
    methods = (
      <>
        <p className="text-center text-sm leading-6 text-ui-subtle">
          {t('account_signed_out_notion_only')}
        </p>
        {onOpenDestinations ? (
          <button
            type="button"
            className={`${QUIET_LOGIN_BUTTON} w-full`}
            onClick={onOpenDestinations}
          >
            {t('destination_required_action')}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section
      id="account"
      aria-labelledby="account-title"
      className="flex flex-1 scroll-mt-24 flex-col justify-center py-8 sm:py-12"
    >
      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <img
          src={logoUrl}
          alt=""
          className="mx-auto mb-1 h-11 w-11 rounded-xl object-cover shadow-sm"
        />
        <h1
          id="account-title"
          className="text-center text-2xl font-semibold tracking-[-0.03em] text-library-ink"
        >
          {t('account_login_title', [productConfig.name])}
        </h1>
        {methods}
        <div className="mt-5 space-y-1 text-center text-xs leading-5 text-ui-subtle">
          <p>{t('account_continue_without_login')}</p>
          {offersPro ? <p>{t('account_login_ai_value')}</p> : null}
        </div>
      </div>
    </section>
  );
}
