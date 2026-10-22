/// <reference types="chrome" />
/// <reference types="vite/client" />
import {
  hasNotionDestination,
  ACCOUNT_REVISION_KEY,
  readAccountContext,
  isAccountContextCurrent,
  isStaleAccountStateError,
  StaleAccountStateError,
  type AccountContext,
  sameAccountContext,
} from '../utils/account-state';
import { mapAccountProfile } from '../utils/account-profile';
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { CACHE_KEYS, WATCHED_CACHE_KEYS } from '../utils/cache';
import { sendMessage, Messages } from '../utils/message';
import type { DashboardSnapshot, SyncEnrichmentStatus } from '../dashboard/types';
import type {
  DeploymentMode,
  DeploymentCapabilities,
  SignInMethod,
} from '@bookmark-assistant/types';
import { productConfig } from '../product-config';

const defaultDeployment = {
  deploymentMode: (productConfig.officialService ? 'hosted' : 'self-hosted') as DeploymentMode,
  commerceEnabled: productConfig.officialService,
  capabilities: undefined as DeploymentCapabilities | undefined,
  signInMethods: [] as readonly SignInMethod[],
};

const FREE_INTERVAL_HOURS = 24;
export const PRO_MIN_INTERVAL_HOURS = 6; // 6 hours
// Leave room for the background's bounded sync request plus its error handling
// and response delivery. This prevents both false failures and endless waits.
const SYNC_MESSAGE_TIMEOUT_MS = 10 * 60_000 + 30_000;
let dashboardRefreshRequest: { context: AccountContext; promise: Promise<void> } | null = null;
let entitlementRefreshId = 0;
let autoSyncUpdateId = 0;

// Pricing constants
const PRICE_MONTHLY_EARLY_BIRD_USD = 1.5; // Fallback $/month
const PRICE_YEARLY_USD = 11.9; // Fallback $/year
const PRICING_CACHE_SCHEMA_VERSION = 2;
export type SubscriptionSource = 'paddle' | 'developer' | 'gift' | 'trial';

export function parseCachedPricing(value: unknown): { monthly: number; yearly: number } | null {
  if (!value || typeof value !== 'object') return null;
  const pricing = value as { monthly?: unknown; yearly?: unknown; schemaVersion?: unknown };
  if (
    pricing.schemaVersion !== PRICING_CACHE_SCHEMA_VERSION ||
    typeof pricing.monthly !== 'number' ||
    !Number.isFinite(pricing.monthly) ||
    typeof pricing.yearly !== 'number' ||
    !Number.isFinite(pricing.yearly)
  ) {
    return null;
  }
  return { monthly: pricing.monthly, yearly: pricing.yearly };
}
export type HydrationState = 'booting' | 'cached' | 'fresh';

function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as DashboardSnapshot;
  return (
    typeof snapshot.generatedAt === 'string' &&
    !!snapshot.connection &&
    ['checking', 'connected', 'degraded', 'disconnected'].includes(snapshot.connection.status) &&
    !!snapshot.library &&
    typeof snapshot.library.bookmarks === 'number' &&
    typeof snapshot.library.readingList === 'number' &&
    typeof snapshot.library.savedToday === 'number' &&
    typeof snapshot.library.duplicatesSkipped === 'number' &&
    !!snapshot.libraryHealth &&
    snapshot.libraryHealth.version === 1 &&
    typeof snapshot.libraryHealth.duplicateGroupCount === 'number' &&
    typeof snapshot.libraryHealth.estimatedLocalSyncItems === 'number' &&
    !!snapshot.sync &&
    typeof snapshot.sync.inProgress === 'boolean' &&
    typeof snapshot.sync.autoSyncEnabled === 'boolean' &&
    typeof snapshot.sync.failedCount === 'number' &&
    Array.isArray(snapshot.recentActivity)
  );
}

function dashboardState(snapshot: DashboardSnapshot): Partial<AppState> {
  return {
    dashboard: snapshot,
    isConnected: snapshot.connection.status !== 'disconnected',
    isSyncing: snapshot.sync.inProgress,
    bookmarkCount: snapshot.library.bookmarks,
    lastSync: snapshot.sync.lastSyncAt || '',
    autoSync: snapshot.sync.autoSyncEnabled,
    syncEnrichment: snapshot.sync.enrichment,
  };
}

export function preserveInMemoryActivity(
  cachedSnapshot: DashboardSnapshot,
  currentSnapshot: DashboardSnapshot | undefined
): DashboardSnapshot {
  if (
    currentSnapshot?.generatedAt === cachedSnapshot.generatedAt &&
    currentSnapshot.recentActivity.length > cachedSnapshot.recentActivity.length
  ) {
    return { ...cachedSnapshot, recentActivity: currentSnapshot.recentActivity };
  }
  return cachedSnapshot;
}

export type AppState = {
  // Overview
  version: string;
  isConnecting: boolean;
  /** A Notion destination is linked to the service account. */
  isConnected: boolean;
  /** A service account session exists. */
  isSignedIn: boolean;
  signInMethods: readonly SignInMethod[];
  hasGoogleSignIn: boolean;
  showPriorNotionHint: boolean;
  isSyncing: boolean;
  syncEnrichment?: SyncEnrichmentStatus;
  isRefreshingProfile: boolean;
  isOptionsInitialized: boolean;
  hydrationState: HydrationState;
  bookmarkCount: number;
  lastSync: string;
  isPro: boolean;
  deploymentMode: DeploymentMode;
  commerceEnabled: boolean;
  capabilities?: DeploymentCapabilities;
  plan: 'free' | 'pro';
  subscriptionSource?: SubscriptionSource | null;
  subscriptionExpiresAt?: string | null;
  purchaseType?: 'monthly' | 'yearly';
  setIsConnecting: (v: boolean) => void;
  setIsSyncing: (v: boolean) => void;
  dashboard?: DashboardSnapshot;
  isDashboardLoading: boolean;
  refreshDashboard: (refreshConnection?: boolean) => Promise<void>;
  syncNow: () => Promise<{ noChanges: boolean }>;

  // Sync feedback
  lastSyncSummary?: {
    type: 'success' | 'no_changes' | 'error';
    message?: string;
  };
  setLastSyncSummary: (summary?: AppState['lastSyncSummary']) => void;

  // User info
  userId: string;
  userEmail: string;

  // Sync settings
  autoSync: boolean;
  intervalHours: number;
  setAutoSync: (v: boolean) => void;
  setIntervalHours: (v: number) => void;

  // Lifecycle
  initFromStorage: () => Promise<void>;
  saveSyncSettings: (nextIntervalHours?: number) => Promise<void>;
  refreshEntitlements: (forceRefresh?: boolean) => Promise<void>;
  refreshConnection: () => Promise<void>;
  loadSignInMethods: () => Promise<void>;

  // Config
  pricing: { monthly: number; yearly: number };
  fetchPricing: () => Promise<void>;
  getEffectiveLimits: () => { minIntervalHours: number };
  getPricing: () => { monthly: number; yearly: number };
};

// Zustand store
export const useAppStore = create<AppState>((set, get) => ({
  ...defaultDeployment,
  version: '',
  isConnecting: false,
  isConnected: false,
  isSignedIn: false,
  signInMethods: [],
  hasGoogleSignIn: false,
  showPriorNotionHint: false,
  isSyncing: false,
  syncEnrichment: undefined,
  isRefreshingProfile: false,
  isOptionsInitialized: false,
  hydrationState: 'booting',
  bookmarkCount: 0,
  lastSync: '',
  isPro: false,
  plan: 'free',
  subscriptionSource: undefined,
  subscriptionExpiresAt: undefined,
  userId: '',
  userEmail: '',
  lastSyncSummary: undefined,
  dashboard: undefined,
  isDashboardLoading: false,
  setIsConnecting: (v: boolean) => set({ isConnecting: v }),
  setIsSyncing: (v: boolean) => set({ isSyncing: v }),
  setLastSyncSummary: (summary) => set({ lastSyncSummary: summary }),
  refreshDashboard: async (refreshConnection = false) => {
    const context = await readAccountContext();
    if (!(await isAccountContextCurrent(context))) return;
    const existing = dashboardRefreshRequest;
    if (existing && sameAccountContext(existing.context, context)) return existing.promise;
    set({ isDashboardLoading: true });
    const request = (async () => {
      try {
        const response = await sendMessage(
          { type: Messages.GET_DASHBOARD_STATE, refreshConnection },
          { timeoutMs: 35_000 }
        );
        if (!(await isAccountContextCurrent(context))) return;
        if (response.success && response.dashboard) {
          set({ ...dashboardState(response.dashboard), hydrationState: 'fresh' });
        }
      } catch (error) {
        if (await isAccountContextCurrent(context))
          console.warn('[Dashboard] Failed to refresh state:', error);
      }
    })();
    const trackedRequest = request.finally(() => {
      if (dashboardRefreshRequest?.promise === trackedRequest) {
        dashboardRefreshRequest = null;
        set({ isDashboardLoading: false });
      }
    });
    dashboardRefreshRequest = { context, promise: trackedRequest };
    return trackedRequest;
  },
  syncNow: async () => {
    if (get().isSyncing) throw new Error('SYNC_ALREADY_IN_PROGRESS');

    const contextRequest = readAccountContext();
    set({ isSyncing: true });
    let context: AccountContext | undefined;
    try {
      context = await contextRequest;
      const response = await sendMessage(
        { type: Messages.SYNC_ALL_BOOKMARKS, accountRevision: context.revision },
        { timeoutMs: SYNC_MESSAGE_TIMEOUT_MS }
      );
      if (!(await isAccountContextCurrent(context))) throw new StaleAccountStateError();
      if (!response?.success) {
        throw new Error(response?.error || 'SYNC_FAILED');
      }

      await get().refreshDashboard(false);
      return { noChanges: response.noChanges === true };
    } catch (error) {
      if (isStaleAccountStateError(error)) throw error;
      // Refresh once even on failure so authentication and dashboard error state
      // stay aligned with the background service. Do not delay error feedback
      // behind a second network request.
      void get().refreshDashboard(false);
      throw error;
    } finally {
      if (!context || (await isAccountContextCurrent(context))) set({ isSyncing: false });
    }
  },

  autoSync: false,
  intervalHours: FREE_INTERVAL_HOURS,
  setAutoSync: async (v: boolean) => {
    const context = await readAccountContext();
    const requestId = ++autoSyncUpdateId;
    const isCurrent = async () =>
      (await isAccountContextCurrent(context)) && requestId === autoSyncUpdateId;
    // Optimistic update - update state FIRST so UI always reflects current state
    set({ autoSync: v });

    // Then validate with server if enabling
    // Users cannot bypass payment by modifying localStorage
    if (v) {
      try {
        const response = await sendMessage({ type: Messages.GET_USER_PROFILE });
        if (!(await isCurrent())) return;
        if (
          !response.success ||
          !(response.profile?.capabilities?.autoSync ?? response.profile?.isPro)
        ) {
          console.warn('🚫 Auto-sync blocked: User is not Pro (server-verified)');
          // Revert state if validation fails
          set({ autoSync: false });
          return;
        }
      } catch (error) {
        if (!(await isCurrent())) return;
        console.error('❌ Failed to verify Pro status for auto-sync:', error);
        // Revert state on error
        set({ autoSync: false });
        return;
      }
    }

    if (!(await isCurrent())) return;
    // Schedule the auto-sync alarm
    const intervalHours = get().intervalHours;
    await sendMessage({
      type: Messages.SCHEDULE_AUTO_SYNC,
      accountRevision: context.revision,
      enabled: v,
      intervalHours,
    });
  },
  setIntervalHours: (v: number) => set({ intervalHours: v }),

  // Default pricing (fallback)
  pricing: {
    monthly: PRICE_MONTHLY_EARLY_BIRD_USD,
    yearly: PRICE_YEARLY_USD,
  },

  initFromStorage: async () => {
    try {
      const context = await readAccountContext();
      const stored = await chrome.storage.local.get([
        CACHE_KEYS.deployment_profile,
        'last_sync',
        'sync_interval_hours',
        'user_id',
        'user_email',
        'session_token',
        CACHE_KEYS.notion_connected,
        'sync_in_progress',
        CACHE_KEYS.sync_enrichment_state,
        'is_connecting',
        'is_pro',
        'purchase_type',
        'subscription_source',
        'subscription_expires_at',
        'account_created_notice',
        'has_google_sign_in',
        'cached_pricing',
        CACHE_KEYS.dashboard_snapshot,
      ]);
      const {
        last_sync,
        sync_interval_hours,
        user_id,
        user_email,
        session_token,
        sync_in_progress,
        is_connecting,
        is_pro,
        purchase_type,
        subscription_source,
        subscription_expires_at,
        cached_pricing,
      } = stored;

      if (!(await isAccountContextCurrent(context))) return;
      const interval = Number(sync_interval_hours);
      const minIntervalHours = is_pro === true ? PRO_MIN_INTERVAL_HOURS : FREE_INTERVAL_HOURS;
      const next = Number.isFinite(interval) ? (interval as number) : minIntervalHours;
      const coerced = Math.max(minIntervalHours, next);
      const cachedDashboard = isDashboardSnapshot(stored[CACHE_KEYS.dashboard_snapshot])
        ? stored[CACHE_KEYS.dashboard_snapshot]
        : undefined;
      const hasSession = !!session_token;
      const notionConnected = hasNotionDestination(stored);
      const validPricing = parseCachedPricing(cached_pricing) || get().pricing;

      const cachedProfile =
        stored.deployment_profile?.apiOrigin === productConfig.apiUrl
          ? stored.deployment_profile
          : undefined;
      const cachedDeployment = cachedProfile ?? defaultDeployment;
      const signInMethods = Array.isArray(cachedProfile?.signInMethods)
        ? cachedProfile.signInMethods
        : get().signInMethods;
      set({
        ...cachedDeployment,
        signInMethods,
        hasGoogleSignIn: stored.has_google_sign_in === true,
        showPriorNotionHint: stored.account_created_notice === true,
        isConnected: notionConnected,
        isSignedIn: hasSession,
        isConnecting: !!is_connecting,
        isSyncing: !!sync_in_progress,
        syncEnrichment: stored[CACHE_KEYS.sync_enrichment_state] as
          | SyncEnrichmentStatus
          | undefined,
        isRefreshingProfile: false,
        dashboard: cachedDashboard,
        bookmarkCount: cachedDashboard?.library.bookmarks ?? get().bookmarkCount,
        lastSync:
          typeof last_sync === 'string' ? last_sync : cachedDashboard?.sync.lastSyncAt || '',
        isPro: is_pro === true,
        plan: is_pro === true ? 'pro' : 'free',
        purchaseType: purchase_type as 'monthly' | 'yearly' | undefined,
        subscriptionSource: subscription_source as SubscriptionSource | undefined,
        subscriptionExpiresAt: subscription_expires_at ?? undefined,
        userId: typeof user_id === 'string' ? user_id : '',
        userEmail: typeof user_email === 'string' ? user_email : '',
        autoSync: cachedDashboard?.sync.autoSyncEnabled ?? false,
        intervalHours: coerced,
        pricing: validPricing,
        hydrationState: 'cached',
      });
    } catch (error) {
      console.error('❌ Failed to initialize from storage:', error);
      set({ hydrationState: 'cached' });
    }
  },

  fetchPricing: async () => {
    if (!get().commerceEnabled || get().deploymentMode === 'self-hosted') return;
    try {
      const response = await sendMessage({ type: Messages.GET_PRICING });
      if (response.success && response.pricing) {
        const pricing = {
          monthly: response.pricing.monthly,
          yearly: response.pricing.yearly,
        };
        set({ pricing });
        // Cache it
        chrome.storage.local.set({
          cached_pricing: { ...pricing, schemaVersion: PRICING_CACHE_SCHEMA_VERSION },
        });
      }
    } catch (error) {
      console.error('❌ Failed to fetch pricing:', error);
    }
  },

  refreshEntitlements: async (forceRefresh = false) => {
    const context = await readAccountContext();
    if (!context.token) return;
    const requestId = ++entitlementRefreshId;
    set({ isRefreshingProfile: true });
    const isCurrent = async () =>
      (await isAccountContextCurrent(context)) && requestId === entitlementRefreshId;
    try {
      if (!forceRefresh) {
        const stored = await chrome.storage.local.get([
          'is_pro',
          'purchase_type',
          'subscription_source',
          'subscription_expires_at',
          'entitlements_cached_at',
          'deployment_profile',
        ]);
        const cachedAt =
          typeof stored.entitlements_cached_at === 'number' ? stored.entitlements_cached_at : 0;
        if (
          Date.now() - cachedAt < 30 * 60_000 &&
          typeof stored.is_pro === 'boolean' &&
          stored.deployment_profile?.apiOrigin === productConfig.apiUrl
        ) {
          if (!(await isCurrent())) return;
          set({
            ...stored.deployment_profile,
            isPro: stored.is_pro,
            plan: stored.is_pro ? 'pro' : 'free',
            purchaseType: stored.purchase_type,
            subscriptionSource: stored.subscription_source,
            subscriptionExpiresAt: stored.subscription_expires_at,
          });
          return;
        }
      }
      const response = await sendMessage({ type: Messages.GET_USER_PROFILE, forceRefresh });
      if (!(await isCurrent())) return;
      if (response.success && response.profile) {
        const profile = mapAccountProfile(response.profile, productConfig.apiUrl);
        set({
          ...profile.state,
          isSignedIn: true,
          hasGoogleSignIn: response.profile.hasGoogleSignIn === true,
          isConnected: response.profile.hasNotionAccess === true,
          ...(typeof response.profile.email === 'string'
            ? { userEmail: response.profile.email }
            : {}),
        });
      }
    } catch (error) {
      if ((await isCurrent()) && !isStaleAccountStateError(error))
        console.error('Failed to refresh user profile:', error);
    } finally {
      if (requestId === entitlementRefreshId) set({ isRefreshingProfile: false });
    }
  },
  refreshConnection: async () => {
    try {
      const { session_token } = await chrome.storage.local.get(['session_token']);

      if (!session_token) {
        set({
          isConnected: false,
          isSignedIn: false,
          isPro: false,
          plan: 'free',
          purchaseType: undefined,
          subscriptionSource: undefined,
          subscriptionExpiresAt: undefined,
        });
        return;
      }

      await get().refreshEntitlements();
    } catch (error) {
      console.error('Failed to refresh connection state:', error);
    }
  },
  saveSyncSettings: async (nextIntervalHours?: number) => {
    const context = await readAccountContext();
    const raw = typeof nextIntervalHours === 'number' ? nextIntervalHours : get().intervalHours;
    // The store's Pro state is populated by the server-verified entitlement response.
    const minIntervalHours = get().getEffectiveLimits().minIntervalHours;
    const rounded = Math.floor(raw * 100) / 100;
    const interval = Math.max(minIntervalHours, rounded);
    await chrome.storage.local.set({
      sync_interval_hours: interval,
      auto_sync_interval_minutes: Math.round(interval * 60), // Keep in sync
    });
    set({ intervalHours: interval });

    // Reschedule auto-sync if enabled
    const autoSync = get().autoSync;
    if (autoSync) {
      await sendMessage({
        type: Messages.SCHEDULE_AUTO_SYNC,
        accountRevision: context.revision,
        enabled: true,
        intervalHours: interval,
      });
    }
  },

  loadSignInMethods: async () => {
    if (get().isSignedIn) return;
    try {
      const response = await sendMessage({ type: Messages.GET_DEPLOYMENT_PROFILE });
      if (get().isSignedIn || !response.success || !response.profile) return;
      set({
        signInMethods: [...response.profile.signInMethods],
        deploymentMode: response.profile.deploymentMode,
        commerceEnabled: response.profile.commerceEnabled,
      });
    } catch (error) {
      console.warn('[Account] Failed to load sign-in methods:', error);
    }
  },

  getEffectiveLimits: () => ({
    minIntervalHours: get().isPro ? PRO_MIN_INTERVAL_HOURS : FREE_INTERVAL_HOURS,
  }),
  getPricing: () => {
    return get().pricing;
  },
}));

/**
 * Applies account and Notion destination changes from storage. A renewed token
 * for the same account must not reset the dashboard; connecting another
 * account, deleting the account, or changing the Notion link does.
 */
async function handleAccountStateChange(changes: { [key: string]: chrome.storage.StorageChange }) {
  const sessionChange = changes[CACHE_KEYS.session_token];
  const userChange = changes[CACHE_KEYS.user_id];
  const stored = await chrome.storage.local.get([
    CACHE_KEYS.session_token,
    CACHE_KEYS.notion_connected,
  ]);
  const state = useAppStore.getState();
  const isSignedIn = !!stored.session_token;
  const isConnected = hasNotionDestination(stored);
  const accountChanged =
    !!changes[ACCOUNT_REVISION_KEY] ||
    !isSignedIn ||
    (!!userChange && userChange.oldValue !== userChange.newValue);
  if (accountChanged) {
    entitlementRefreshId++;
    autoSyncUpdateId++;
    dashboardRefreshRequest = null;
  }
  const shouldClearDashboard = accountChanged || isConnected !== state.isConnected;

  useAppStore.setState({
    isSignedIn,
    isConnected,
    ...(accountChanged ? { isRefreshingProfile: false, isDashboardLoading: false } : {}),
    ...(!isSignedIn
      ? {
          ...defaultDeployment,
          signInMethods: state.signInMethods,
          hasGoogleSignIn: false,
          showPriorNotionHint: false,
          isPro: false,
          plan: 'free' as const,
          userId: '',
          userEmail: '',
          purchaseType: undefined,
          subscriptionSource: undefined,
          subscriptionExpiresAt: undefined,
          autoSync: false,
        }
      : {}),
    ...(shouldClearDashboard
      ? {
          dashboard: undefined,
          isSyncing: false,
          syncEnrichment: undefined,
        }
      : {}),
  });
  if (shouldClearDashboard) void chrome.storage.local.remove(CACHE_KEYS.dashboard_snapshot);

  const signedInNow = !!sessionChange && !sessionChange.oldValue && !!sessionChange.newValue;
  if (signedInNow || (isSignedIn && accountChanged)) {
    void useAppStore.getState().refreshEntitlements(true);
  }
}

// Thin provider to run init effects and listeners
export function AppProvider({ children }: { children: ReactNode }) {
  const initialized = useRef(false);
  // Version
  useEffect(() => {
    try {
      const mf = chrome.runtime.getManifest?.();
      if (mf?.version) useAppStore.setState({ version: mf.version });
    } catch {}
  }, []);

  useEffect(() => {
    const storageEvents = globalThis.chrome?.storage?.onChanged;
    if (!storageEvents) return;

    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'local') return;
      const shot = WATCHED_CACHE_KEYS.some((key) => key in changes);
      if (!shot) return;

      if (
        changes[CACHE_KEYS.session_token] ||
        changes[CACHE_KEYS.notion_connected] ||
        changes[ACCOUNT_REVISION_KEY] ||
        changes[CACHE_KEYS.user_id]
      ) {
        void handleAccountStateChange(changes);
      }
      if (changes['is_connecting']) {
        useAppStore.setState({ isConnecting: !!changes['is_connecting'].newValue });
      }
      if (changes['last_sync']) {
        const s = changes['last_sync'].newValue as string | undefined;
        useAppStore.setState({ lastSync: s || '' });
      }
      if (changes[CACHE_KEYS.last_sync_summary]) {
        const summary = changes[CACHE_KEYS.last_sync_summary].newValue as string | undefined;
        if (summary === 'no_changes') {
          useAppStore.setState({
            lastSyncSummary: {
              type: 'no_changes',
              message: 'Everything is up to date',
            },
          });
        } else if (!summary) {
          useAppStore.setState({ lastSyncSummary: undefined });
        }
      }
      if (changes['sync_in_progress']) {
        useAppStore.setState({ isSyncing: !!changes['sync_in_progress'].newValue });
      }
      if (changes[CACHE_KEYS.sync_enrichment_state]) {
        useAppStore.setState({
          syncEnrichment: changes[CACHE_KEYS.sync_enrichment_state].newValue as
            | SyncEnrichmentStatus
            | undefined,
        });
      }
      if (changes['user_id']) {
        const userId = changes['user_id'].newValue as string | undefined;
        useAppStore.setState({ userId: userId || '' });
      }
      if (changes['user_email']) {
        const userEmail = changes['user_email'].newValue as string | undefined;
        useAppStore.setState({ userEmail: userEmail || '' });
      }
      if (changes['is_pro']) {
        const isPro = !!changes['is_pro'].newValue;
        useAppStore.setState({ isPro, plan: isPro ? 'pro' : 'free' });
      }
      if (changes[CACHE_KEYS.deployment_profile]) {
        const deployment = changes[CACHE_KEYS.deployment_profile].newValue;
        const signInMethods = useAppStore.getState().signInMethods;
        useAppStore.setState(
          deployment?.apiOrigin === productConfig.apiUrl
            ? {
                ...deployment,
                signInMethods: Array.isArray(deployment.signInMethods)
                  ? deployment.signInMethods
                  : signInMethods,
              }
            : { ...defaultDeployment, signInMethods }
        );
      }
      if ('account_created_notice' in changes) {
        useAppStore.setState({
          showPriorNotionHint: changes.account_created_notice.newValue === true,
        });
      }
      if ('has_google_sign_in' in changes) {
        useAppStore.setState({
          hasGoogleSignIn: changes.has_google_sign_in.newValue === true,
        });
      }
      if (changes['purchase_type']) {
        const purchaseType = changes['purchase_type'].newValue as 'monthly' | 'yearly' | undefined;
        useAppStore.setState({ purchaseType });
      }
      if (changes['subscription_source']) {
        const subscriptionSource = changes['subscription_source'].newValue as
          | SubscriptionSource
          | null
          | undefined;
        useAppStore.setState({ subscriptionSource });
      }
      if (changes['subscription_expires_at']) {
        const subscriptionExpiresAt = changes['subscription_expires_at'].newValue as
          | string
          | null
          | undefined;
        useAppStore.setState({ subscriptionExpiresAt });
      }
      if (changes['cached_pricing']) {
        const pricing = parseCachedPricing(changes['cached_pricing'].newValue);
        if (pricing) useAppStore.setState({ pricing });
      }
      if (changes['auto_sync_enabled']) {
        const autoSyncEnabled = !!changes['auto_sync_enabled'].newValue;
        // Note: autoSync is now controlled by setAutoSync which validates with server
        // We only reflect the storage state here, but actual sync requires server validation
        useAppStore.setState({ autoSync: autoSyncEnabled });
      }
      if (changes['auto_sync_interval_minutes']) {
        const minutes = changes['auto_sync_interval_minutes'].newValue as number | undefined;
        if (minutes) {
          useAppStore.setState({ intervalHours: minutes / 60 });
        }
      }
      if (changes[CACHE_KEYS.dashboard_snapshot]) {
        const snapshot = changes[CACHE_KEYS.dashboard_snapshot].newValue;
        if (isDashboardSnapshot(snapshot)) {
          const renderableSnapshot = preserveInMemoryActivity(
            snapshot,
            useAppStore.getState().dashboard
          );
          useAppStore.setState({ ...dashboardState(renderableSnapshot), hydrationState: 'fresh' });
        }
      }
      if (
        changes[CACHE_KEYS.dashboard_last_sync] ||
        changes[CACHE_KEYS.dashboard_recent_activity] ||
        changes[CACHE_KEYS.dashboard_saved_today]
      ) {
        void useAppStore.getState().refreshDashboard(false);
      }
    };
    storageEvents.addListener(onChanged);
    return () => storageEvents.removeListener(onChanged);
  }, []);

  // Load local cached state only. Destination and account screens explicitly
  // request their remote data when mounted, so the default Library stays local.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!globalThis.chrome?.storage?.local) {
      useAppStore.setState({ isOptionsInitialized: true, hydrationState: 'fresh' });
      return;
    }

    (async () => {
      await useAppStore.getState().initFromStorage();
      useAppStore.setState({ isOptionsInitialized: true });
    })();
  }, []);

  return children as any;
}
