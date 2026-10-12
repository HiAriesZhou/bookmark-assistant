import { Check, ChevronDown, Crown, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { openPaddleCheckout } from '../../lib/paddle';
import { createTranslator } from '../../utils/i18n';
import { Messages, sendMessage } from '../../utils/message';
import { PRO_MIN_INTERVAL_HOURS, useAppStore } from '../store';
import {
  deriveSubscriptionViewModel,
  getSubscriptionAction,
  type SubscriptionKind,
} from '../subscription-view-model';
import { useToast } from '../hook/useToast';
import { SettingsGroup, SettingsRow } from './Workspace';

const PLAN_COMPARISON_ID = 'plan-comparison';

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(value: number) {
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}`;
}

function planTitle(
  kind: SubscriptionKind,
  t: (key: string, substitutions?: string | string[]) => string,
  localMode: boolean
) {
  if (kind === 'free')
    return t(localMode ? 'subscription_local_mode' : 'subscription_free_current');
  if (kind === 'trial') return t('subscription_trial_active');
  if (kind === 'loading') return t('loading');
  return t('subscription_pro_active');
}

type BillingSectionProps = { plansExpanded: boolean; onTogglePlans: (next?: boolean) => void };

export function BillingSection(props: BillingSectionProps) {
  const enabled = useAppStore(
    (state) => state.deploymentMode === 'hosted' && state.commerceEnabled
  );
  return enabled ? <HostedBillingSection {...props} /> : null;
}

function HostedBillingSection({
  plansExpanded,
  onTogglePlans,
}: {
  plansExpanded: boolean;
  onTogglePlans: (next?: boolean) => void;
}) {
  const { t } = createTranslator();
  const { show } = useToast();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [nextBillingDate, setNextBillingDate] = useState<string | null>(null);
  const [hasLoadedBillingInfo, setHasLoadedBillingInfo] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const {
    plan,
    isPro,
    isSignedIn,
    userId,
    userEmail,
    purchaseType,
    subscriptionSource,
    subscriptionExpiresAt,
    isRefreshingProfile,
    isOptionsInitialized,
    refreshEntitlements,
    getPricing,
  } = useAppStore();
  const pricing = getPricing();
  const subscription = useMemo(
    () =>
      deriveSubscriptionViewModel({
        isLoading: !isOptionsInitialized || (isRefreshingProfile && !subscriptionSource && !isPro),
        plan,
        isPro,
        subscriptionSource,
        purchaseType,
        subscriptionExpiresAt,
        userEmail,
      }),
    [
      isRefreshingProfile,
      isOptionsInitialized,
      isPro,
      plan,
      purchaseType,
      subscriptionExpiresAt,
      subscriptionSource,
      userEmail,
    ]
  );
  const action = getSubscriptionAction(subscription.kind);
  // No service account yet: local management needs no plan, so show local mode, not Free.
  const localMode = !isSignedIn && subscription.kind === 'free';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') !== 'true') return;
    window.history.replaceState({}, '', window.location.pathname);
    show({
      title: t('payment_success_title'),
      description: t('payment_activating_desc'),
      variant: 'success',
      duration: 5000,
    });

    const checkEntitlements = async (retries = 3, delay = 2000) => {
      await refreshEntitlements(true);
      if (!useAppStore.getState().isPro && retries > 0) {
        window.setTimeout(() => void checkEntitlements(retries - 1, delay * 1.5), delay);
      } else if (useAppStore.getState().isPro) {
        show({
          title: t('pro_activated_title'),
          description: t('pro_activated_desc'),
          variant: 'success',
          duration: 3000,
        });
      }
    };
    void checkEntitlements();
  }, [refreshEntitlements, show, t]);

  useEffect(() => {
    if (!['paddle-monthly', 'paddle-yearly'].includes(subscription.kind)) {
      setNextBillingDate(null);
      setHasLoadedBillingInfo(false);
      return;
    }
    setHasLoadedBillingInfo(false);
    void (async () => {
      try {
        const response = await sendMessage({ type: Messages.GET_SUBSCRIPTION_INFO });
        if (response.success && response.nextBillingDate)
          setNextBillingDate(response.nextBillingDate);
      } catch (error) {
        console.error('Failed to fetch subscription info:', error);
      } finally {
        setHasLoadedBillingInfo(true);
      }
    })();
  }, [subscription.kind]);

  const handleCheckout = async () => {
    if (!userId) {
      show({ variant: 'error', title: t('upgrade_requires_connection') });
      return;
    }
    try {
      setIsCheckingOut(true);
      await openPaddleCheckout({
        pricing: billing,
        userId,
        userEmail: userEmail || undefined,
        successUrl: `${import.meta.env.VITE_WEBSITE_URL || ''}/success`,
      });
    } catch (error) {
      show({
        variant: 'error',
        title: t('error_checkout_failed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handlePortal = async () => {
    const portalWindow = window.open('', '_blank');
    if (!portalWindow) {
      show({
        variant: 'error',
        title: t('portal_open_failed'),
        description: t('portal_popup_blocked'),
      });
      return;
    }
    try {
      setIsOpeningPortal(true);
      const response = await sendMessage({ type: Messages.GET_PORTAL_LINK });
      if (!response.success || !response.url)
        throw new Error(response.error || t('portal_open_failed'));
      portalWindow.opener = null;
      portalWindow.location.href = response.url;
    } catch (error) {
      portalWindow.close();
      show({
        variant: 'error',
        title: t('portal_open_failed'),
        description: error instanceof Error ? error.message : t('portal_open_failed'),
      });
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const fields: Array<[string, string]> = [];
  if (subscription.kind === 'paddle-monthly') {
    fields.push([t('purchase_type_label'), t('billing_monthly')]);
    if (nextBillingDate) {
      fields.push([t('next_billing_date_label'), formatDate(nextBillingDate)]);
    } else if (!hasLoadedBillingInfo) {
      fields.push([t('next_billing_date_label'), t('loading')]);
    }
  } else if (subscription.kind === 'paddle-yearly') {
    fields.push([t('purchase_type_label'), t('billing_yearly')]);
    if (nextBillingDate) {
      fields.push([t('next_billing_date_label'), formatDate(nextBillingDate)]);
    } else if (!hasLoadedBillingInfo) {
      fields.push([t('next_billing_date_label'), t('loading')]);
    }
  } else if (subscription.kind === 'developer') {
    fields.push([t('license_label'), t('license_developer')]);
  } else if (subscription.kind === 'gift') {
    fields.push([t('license_label'), t('license_gift')]);
  }
  if (subscription.expirationDate) {
    fields.push([t('expiration_label'), formatDate(subscription.expirationDate)]);
  }

  const planToggle = action === 'view-plans' || action === 'upgrade';

  return (
    <SettingsGroup
      id="billing"
      title={t('subscription_management_title')}
      action={
        <button
          type="button"
          onClick={() => refreshEntitlements(true)}
          disabled={isRefreshingProfile}
          aria-label={isRefreshingProfile ? t('refreshing') : t('action_refresh')}
          title={isRefreshingProfile ? t('refreshing') : t('action_refresh')}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ui-subtle hover:bg-ui-surface-hover hover:text-ui-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus disabled:text-ui-disabled"
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${isRefreshingProfile ? 'animate-spin' : ''}`}
          />
        </button>
      }
    >
      <SettingsRow
        label={
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${subscription.kind === 'loading' ? 'bg-ui-disabled' : 'bg-ui-success'}`}
            />
            {planTitle(subscription.kind, t, localMode)}
          </span>
        }
        description={
          subscription.kind === 'loading'
            ? undefined
            : localMode
              ? t('subscription_local_mode_desc')
              : subscription.email || t('no_email_linked')
        }
        controlAlign="end"
        control={
          action === 'manage-portal' ? (
            <button
              type="button"
              onClick={handlePortal}
              disabled={isOpeningPortal}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-4 text-sm font-medium text-ui-body hover:bg-ui-surface-hover disabled:text-ui-disabled"
            >
              {isOpeningPortal ? t('loading') : t('manage_subscription')}
            </button>
          ) : planToggle ? (
            <button
              type="button"
              onClick={() => onTogglePlans()}
              aria-expanded={plansExpanded}
              aria-controls={PLAN_COMPARISON_ID}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ui-control px-4 text-sm font-medium text-white hover:bg-ui-control-hover"
            >
              {action === 'upgrade' ? t('upgrade') : t('view_plans')}
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${plansExpanded ? 'rotate-180' : ''}`}
              />
            </button>
          ) : undefined
        }
      />

      {fields.map(([label, value]) => (
        <SettingsRow
          key={label}
          label={label}
          controlAlign="end"
          control={<p className="truncate text-sm text-ui-body">{value}</p>}
        />
      ))}

      {plansExpanded && planToggle ? (
        <div id={PLAN_COMPARISON_ID} className="p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 tabIndex={-1} className="text-sm font-semibold text-ui-ink">
              {t('plan_comparison_title')}
            </h3>
            <div className="inline-flex w-fit rounded-lg border border-ui-line bg-ui-surface-subtle p-0.5">
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                aria-pressed={billing === 'monthly'}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${billing === 'monthly' ? 'bg-white text-ui-ink shadow-ui-sm' : 'text-ui-subtle hover:text-ui-body'}`}
              >
                {t('billing_monthly')}
              </button>
              <button
                type="button"
                onClick={() => setBilling('yearly')}
                aria-pressed={billing === 'yearly'}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${billing === 'yearly' ? 'bg-white text-ui-ink shadow-ui-sm' : 'text-ui-subtle hover:text-ui-body'}`}
              >
                {t('billing_yearly')}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <article className="flex flex-col rounded-xl bg-ui-surface-subtle p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ui-subtle">
                {t('free')}
              </p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ui-ink">$0</p>
              <p className="mt-2 text-sm text-ui-subtle">{t('free_plan_desc')}</p>
              <ul className="mt-5 space-y-3 text-sm text-ui-body">
                {[
                  t('feature_local_library'),
                  t('feature_bookmarks_sync'),
                  t('feature_manual_sync'),
                ].map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ui-success" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="relative flex flex-col overflow-hidden rounded-xl border border-[#2b2f37] bg-[#181b21] p-5 text-white shadow-[0_16px_36px_rgba(24,27,33,0.18)]">
              <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-amber-400/15 blur-2xl" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-200">
                    {t('pro')}
                  </p>
                </div>
                {billing === 'yearly' ? (
                  <span className="rounded-full bg-amber-300/15 px-2 py-1 text-[10px] font-semibold text-amber-200">
                    {t('best_value_badge')}
                  </span>
                ) : null}
              </div>
              <div className="relative mt-3 flex items-end gap-2">
                <span className="text-3xl font-semibold tracking-[-0.04em]">
                  {formatCurrency(pricing[billing])}
                </span>
                <span className="pb-1 text-xs text-gray-400">
                  {billing === 'yearly' ? t('per_year') : t('per_month')}
                </span>
              </div>
              <p className="relative mt-2 text-sm text-gray-400">{t('pro_plan_desc')}</p>
              <ul className="relative mt-5 flex-1 space-y-3 text-sm text-gray-100">
                {[
                  t('auto_sync_label'),
                  t('feature_pro_interval', String(PRO_MIN_INTERVAL_HOURS)),
                  t('feature_batch_ai'),
                ].map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleCheckout}
                disabled={isCheckingOut}
                className="relative mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#181b21] transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#181b21] disabled:bg-gray-700 disabled:text-gray-400"
              >
                {isCheckingOut ? t('loading') : t('action_upgrade_pro')}
              </button>
            </article>
          </div>
        </div>
      ) : null}
    </SettingsGroup>
  );
}
