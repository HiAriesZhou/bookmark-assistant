import { Check, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openPaddleCheckout } from '../../lib/paddle';
import { createTranslator } from '../../utils/i18n';
import { Messages, sendMessage } from '../../utils/message';
import { PRO_MIN_INTERVAL_HOURS, selectPlanPending, useAppStore } from '../store';
import {
  deriveSubscriptionViewModel,
  getSubscriptionAction,
  type SubscriptionKind,
} from '../subscription-view-model';
import { useToast } from '../hook/useToast';
import { SettingsRow } from './Workspace';

// The AI section links here when a Free account reaches a Pro feature.
export const PLAN_UPGRADE_ID = 'plan-upgrade';

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
  if (kind === 'free') return t(localMode ? 'subscription_local_mode' : 'account_plan_free');
  if (kind === 'trial') return t('subscription_trial_active');
  if (kind === 'loading') return t('loading');
  return t('account_plan_pro');
}

/** Plan rows for the account group: the current plan, its billing details and the Pro offer. */
export function PlanRows() {
  const enabled = useAppStore(
    (state) => state.deploymentMode === 'hosted' && state.commerceEnabled
  );
  return enabled ? <HostedPlanRows /> : null;
}

function HostedPlanRows() {
  const { t } = createTranslator();
  const { show } = useToast();
  const [billing, setBilling] = useState<Billing>('yearly');
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
    isOptionsInitialized,
    refreshEntitlements,
    getPricing,
    fetchPricing,
  } = useAppStore();
  const pricing = getPricing();
  const planPending = useAppStore(selectPlanPending);
  const subscription = useMemo(
    () =>
      deriveSubscriptionViewModel({
        // Only an unknown plan shows loading; a manual refresh keeps the current data in place
        // while the refresh button spins.
        isLoading: !isOptionsInitialized || planPending,
        plan,
        isPro,
        subscriptionSource,
        purchaseType,
        subscriptionExpiresAt,
        userEmail,
      }),
    [
      planPending,
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
  const offersUpgrade = action === 'view-plans' || action === 'upgrade';

  // The Pro offer is always visible to Free accounts, so its price loads with the page.
  useEffect(() => {
    if (offersUpgrade) void fetchPricing();
  }, [offersUpgrade, fetchPricing]);
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

  return (
    <>
      {/* The plan reads like the billing fields below it: a label and the account's value. */}
      <SettingsRow
        label={t('account_plan_label')}
        description={localMode ? t('subscription_local_mode_desc') : undefined}
        controlAlign="end"
        control={
          <div className="flex items-center gap-3">
            <p
              className={`text-sm ${subscription.kind === 'loading' ? 'text-ui-subtle' : 'font-medium text-ui-ink'}`}
            >
              {planTitle(subscription.kind, t, localMode)}
            </p>
            {action === 'manage-portal' ? (
              <button
                type="button"
                onClick={handlePortal}
                disabled={isOpeningPortal}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-4 text-sm font-medium text-ui-body hover:bg-ui-surface-hover disabled:text-ui-disabled"
              >
                {isOpeningPortal ? t('loading') : t('manage_subscription')}
              </button>
            ) : null}
          </div>
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

      {offersUpgrade ? (
        <PlanComparison
          billing={billing}
          onBillingChange={setBilling}
          price={formatCurrency(pricing[billing])}
          checkingOut={isCheckingOut}
          onUpgrade={() => void handleCheckout()}
        />
      ) : null}
    </>
  );
}

/** Re-reads the plan from the server, for example right after a payment. */
export function RefreshPlanButton() {
  const { t } = createTranslator();
  const isRefreshingProfile = useAppStore((state) => state.isRefreshingProfile);
  const refreshEntitlements = useAppStore((state) => state.refreshEntitlements);
  return (
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
  );
}

type Billing = 'monthly' | 'yearly';

/**
 * Free and Pro side by side for accounts that can upgrade. It uses the settings tokens and
 * row spacing, so the comparison reads as part of the account group, not a promotion.
 */
function PlanComparison({
  billing,
  onBillingChange,
  price,
  checkingOut,
  onUpgrade,
}: {
  billing: Billing;
  onBillingChange: (billing: Billing) => void;
  price: string;
  checkingOut: boolean;
  onUpgrade: () => void;
}) {
  const { t } = createTranslator();
  return (
    <div
      id={PLAN_UPGRADE_ID}
      className="grid scroll-mt-24 divide-y divide-ui-line sm:grid-cols-2 sm:divide-x sm:divide-y-0"
    >
      <PlanColumn
        name={t('account_plan_free')}
        description={t('free_plan_desc')}
        price="$0"
        features={[
          t('feature_local_library'),
          t('feature_bookmarks_sync'),
          t('feature_manual_sync'),
        ]}
        footer={
          <p className="inline-flex h-9 items-center justify-center gap-1.5 text-xs font-medium text-ui-subtle">
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
            {t('plan_current')}
          </p>
        }
      />
      <PlanColumn
        name={t('account_plan_pro')}
        description={t('pro_plan_desc')}
        price={price}
        period={billing === 'yearly' ? t('per_year') : t('per_month')}
        aside={
          <div className="inline-flex shrink-0 rounded-lg border border-ui-line bg-ui-surface-subtle p-0.5">
            {(['monthly', 'yearly'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onBillingChange(option)}
                aria-pressed={billing === option}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${billing === option ? 'bg-white text-ui-ink shadow-ui-sm' : 'text-ui-subtle hover:text-ui-body'}`}
              >
                {t(option === 'monthly' ? 'billing_monthly' : 'billing_yearly')}
              </button>
            ))}
          </div>
        }
        features={[
          t('feature_everything_in_free'),
          t('feature_pro_interval', String(PRO_MIN_INTERVAL_HOURS)),
          t('feature_batch_ai'),
        ]}
        footer={
          <button
            type="button"
            onClick={onUpgrade}
            disabled={checkingOut}
            className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-ui-control px-4 text-sm font-medium text-white transition-transform hover:bg-ui-control-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkingOut ? t('loading') : t('action_upgrade_pro')}
          </button>
        }
      />
    </div>
  );
}

function PlanColumn({
  name,
  description,
  price,
  period,
  aside,
  features,
  footer,
}: {
  name: string;
  description: string;
  price: string;
  period?: string;
  aside?: ReactNode;
  features: string[];
  footer: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ui-ink">{name}</p>
          <p className="mt-0.5 text-xs leading-5 text-ui-subtle">{description}</p>
        </div>
        {aside}
      </div>
      <p className="whitespace-nowrap">
        <span className="text-lg font-semibold tracking-[-0.02em] text-ui-ink">{price}</span>
        {period ? <span className="ml-1 text-xs text-ui-subtle">{period}</span> : null}
      </p>
      <ul className="flex-1 space-y-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2 text-xs leading-5 text-ui-body">
            <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ui-subtle" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
