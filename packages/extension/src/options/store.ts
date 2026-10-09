/// <reference types="chrome" />
/// <reference types="vite/client" />
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { CACHE_KEYS, WATCHED_CACHE_KEYS } from '../utils/cache';
import { sendMessage, Messages } from '../utils/message';
import type { DashboardSnapshot, SyncEnrichmentStatus } from '../dashboard/types';
import type { DeploymentMode, DeploymentCapabilities } from '@bookmark-assistant/types';
import { productConfig } from '../product-config';

const defaultDeployment = {
  deploymentMode: (productConfig.profile === 'official'
    ? 'hosted'
    : 'self-hosted') as DeploymentMode,
  commerceEnabled: productConfig.profile === 'official',
  capabilities: undefined as DeploymentCapabilities | undefined,
};

export const FREE_INTERVAL_HOURS = 24;
export const PRO_MIN_INTERVAL_HOURS = 6; // 6 hours
export const PRO_MIN_INTERVAL_MINUTES = Math.round(PRO_MIN_INTERVAL_HOURS * 60);
// Leave room for the background's bounded sync request plus its error handling
// and response delivery. This prevents both false failures and endless waits.
const SYNC_MESSAGE_TIMEOUT_MS = 10 * 60_000 + 30_000;
let dashboardRefreshRequest: Promise<void> | null = null;

// Pricing constants
export const PRICE_MONTHLY_EARLY_BIRD_USD = 1.5; // Fallback $/month
export const PRICE_YEARLY_USD = 11.9; // Fallback $/year
export const PRICING_CACHE_SCHEMA_VERSION = 2;
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
  isConnected: boolean;
  isSyncing: boolean;
  syncEnrichment?: SyncEnrichmentStatus;
  isRefreshingProfile: boolean;
  isOptionsInitialized: boolean;
  hydrationState: HydrationState;
  hasTriedInitialLoad: boolean;
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
  setUserInfo: (userId: string, userEmail?: string) => void;

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
  isSyncing: false,
  syncEnrichment: undefined,
  isRefreshingProfile: false,
  isOptionsInitialized: false,
  hydrationState: 'booting',
  hasTriedInitialLoad: false,
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
  refreshDashboard: (refreshConnection = false) => {
    if (dashboardRefreshRequest) return dashboardRefreshRequest;

    set({ isDashboardLoading: true });
    const request = (async () => {
      try {
        const response = await sendMessage(
          {
            type: Messages.GET_DASHBOARD_STATE,
            refreshConnection,
          },
          { timeoutMs: 35_000 }
        );
        if (response.success && response.dashboard) {
          set({ ...dashboardState(response.dashboard), hydrationState: 'fresh' });
          const cachedSnapshot: DashboardSnapshot = {
            ...response.dashboard,
            // Activity is intentionally not part of the Popup experience or its startup cache.
            recentActivity: [],
          };
          void chrome.storage.local
            .set({ [CACHE_KEYS.dashboard_snapshot]: cachedSnapshot })
            .catch((error) => console.warn('[Dashboard] Failed to cache snapshot:', error));
        }
      } catch (error) {
        console.warn('[Dashboard] Failed to refresh state:', error);
      } finally {
        dashboardRefreshRequest = null;
        set({ isDashboardLoading: false });
      }
    })();
    dashboardRefreshRequest = request;
    return request;
  },
  syncNow: async () => {
    if (get().isSyncing) throw new Error('SYNC_ALREADY_IN_PROGRESS');

    set({ isSyncing: true });
    try {
      const response = await sendMessage(
        { type: Messages.SYNC_ALL_BOOKMARKS },
        { timeoutMs: SYNC_MESSAGE_TIMEOUT_MS }
      );
      if (!response?.success) {
        throw new Error(response?.error || 'SYNC_FAILED');
      }

      await get().refreshDashboard(false);
      return { noChanges: response.noChanges === true };
    } catch (error) {
      // Refresh once even on failure so authentication and dashboard error state
      // stay aligned with the background service. Do not delay error feedback
      // behind a second network request.
      void get().refreshDashboard(false);
      throw error;
    } finally {
      set({ isSyncing: false });
    }
  },
  setUserInfo: (userId: string, userEmail?: string) => {
    set({ userId, userEmail: userEmail || '' });
    // Also persist to storage for Paddle checkout
    chrome.storage.local.set({
      user_id: userId,
      user_email: userEmail || '',
    });
  },

  autoSync: false,
  intervalHours: FREE_INTERVAL_HOURS,
  setAutoSync: async (v: boolean) => {
    // Optimistic update - update state FIRST so UI always reflects current state
    set({ autoSync: v });

    // Then validate with server if enabling
    // Users cannot bypass payment by modifying localStorage
    if (v) {
      try {
        const response = await sendMessage({ type: Messages.GET_USER_PROFILE });
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
        console.error('❌ Failed to verify Pro status for auto-sync:', error);
        // Revert state on error
        set({ autoSync: false });
        return;
      }
    }

    // Persist using single source of truth
    await chrome.storage.local.set({
      auto_sync_enabled: v,
    });
    // Schedule the auto-sync alarm
    const intervalHours = get().intervalHours;
    await sendMessage({
      type: Messages.SCHEDULE_AUTO_SYNC,
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
      const stored = await chrome.storage.local.get([
        CACHE_KEYS.deployment_profile,
        'last_sync',
        'sync_interval_hours',
        'user_id',
        'user_email',
        'session_token',
        'sync_in_progress',
        CACHE_KEYS.sync_enrichment_state,
        'is_connecting',
        'is_refreshing_entitlements',
        'is_pro',
        'purchase_type',
        'subscription_source',
        'subscription_expires_at',
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
        is_refreshing_entitlements,
        is_pro,
        purchase_type,
        subscription_source,
        subscription_expires_at,
        cached_pricing,
      } = stored;

      // Clear any stale refreshing state from previous page loads/crashes
      if (is_refreshing_entitlements) {
        console.log('[Init] Clearing stale is_refreshing_entitlements state');
        await chrome.storage.local.set({ is_refreshing_entitlements: false });
      }

      const interval = Number(sync_interval_hours);
      const minIntervalHours = is_pro === true ? PRO_MIN_INTERVAL_HOURS : FREE_INTERVAL_HOURS;
      const next = Number.isFinite(interval) ? (interval as number) : minIntervalHours;
      const coerced = Math.max(minIntervalHours, next);
      const cachedDashboard = isDashboardSnapshot(stored[CACHE_KEYS.dashboard_snapshot])
        ? stored[CACHE_KEYS.dashboard_snapshot]
        : undefined;
      const hasSession = !!session_token;
      const validPricing = parseCachedPricing(cached_pricing) || get().pricing;

      set({
        ...(stored.deployment_profile?.apiOrigin === productConfig.apiUrl
          ? stored.deployment_profile
          : defaultDeployment),
        isConnected: hasSession,
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
    // Check BEFORE setting state - this prevents the bug where we check after setting to true
    // which always returns true (causing the function to never complete)
    const { is_refreshing_entitlements } = await chrome.storage.local.get([
      'is_refreshing_entitlements',
    ]);
    if (is_refreshing_entitlements && !forceRefresh) {
      console.log('[Entitlements] Already refreshing, skipping');
      return;
    }

    // Set storage FIRST to prevent race conditions with concurrent calls
    await chrome.storage.local.set({ is_refreshing_entitlements: true });
    set({ isRefreshingProfile: true });

    // Add timeout fallback - auto-reset after 30 seconds for network issues
    const TIMEOUT_MS = 30000;
    const timeoutId = setTimeout(() => {
      console.warn('[Entitlements] Refresh timeout - resetting state');
      chrome.storage.local.set({ is_refreshing_entitlements: false });
      set({ isRefreshingProfile: false });
    }, TIMEOUT_MS);

    try {
      // Check cache first unless force refresh
      if (!forceRefresh) {
        const {
          is_pro,
          purchase_type,
          subscription_source,
          subscription_expires_at,
          entitlements_cached_at,
        } = await chrome.storage.local.get([
          'is_pro',
          'purchase_type',
          'subscription_source',
          'subscription_expires_at',
          'entitlements_cached_at',
        ]);

        // Use cache if less than 30 minutes old
        const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();
        const cachedAt = typeof entitlements_cached_at === 'number' ? entitlements_cached_at : 0;
        const isCacheValid = now - cachedAt < CACHE_TTL_MS;

        const { deployment_profile } = await chrome.storage.local.get('deployment_profile');
        if (
          isCacheValid &&
          typeof is_pro === 'boolean' &&
          deployment_profile?.apiOrigin === productConfig.apiUrl
        ) {
          console.log('[Entitlements] Using cached Pro status:', is_pro);
          // Combine into single set() for performance
          set({
            ...deployment_profile,
            isPro: is_pro,
            plan: is_pro ? 'pro' : 'free',
            purchaseType: purchase_type,
            subscriptionSource: subscription_source,
            subscriptionExpiresAt: subscription_expires_at,
            isRefreshingProfile: false,
          });
          return;
        }
      }

      // Fetch fresh entitlements from server
      console.log('[Entitlements] Fetching fresh entitlements from server');
      const response = await sendMessage({
        type: Messages.GET_USER_PROFILE,
        forceRefresh,
      });

      if (response.success && response.profile) {
        const isPro = response.profile.isPro === true;
        const plan = response.profile.plan === 'pro' ? 'pro' : 'free';
        const subscriptionSource = response.profile.subscriptionSource as
          | SubscriptionSource
          | null
          | undefined;
        const subscriptionExpiresAt = response.profile.expiresAt ?? null;
        const purchaseType = response.profile.purchaseType as 'monthly' | 'yearly' | undefined;
        const deploymentMode: DeploymentMode =
          response.profile.deploymentMode === 'self-hosted' ? 'self-hosted' : 'hosted';
        const commerceEnabled =
          deploymentMode === 'hosted' && (response.profile.commerceEnabled ?? true);
        const capabilities = response.profile.capabilities || { autoSync: isPro, batchAi: isPro };
        const deployment = { deploymentMode, commerceEnabled, capabilities };
        set({
          ...deployment,
          isPro,
          plan,
          purchaseType,
          subscriptionSource,
          subscriptionExpiresAt,
        });

        // Cache with timestamp for performance
        await chrome.storage.local.set({
          deployment_profile: { ...deployment, apiOrigin: productConfig.apiUrl },
          is_pro: isPro,
          purchase_type: purchaseType,
          subscription_source: subscriptionSource,
          subscription_expires_at: subscriptionExpiresAt,
          entitlements_cached_at: Date.now(),
        });
      }
    } catch (error: any) {
      console.error('Failed to refresh user profile:', error);

      const is401 =
        error?.status === 401 || error?.message?.includes('401') || error?.code === 'UNAUTHORIZED';
      if (is401) {
        set({
          isConnected: false,
          isPro: false,
          plan: 'free',
          purchaseType: undefined,
          subscriptionSource: undefined,
          subscriptionExpiresAt: undefined,
        });
        chrome.storage.local.remove(['session_token', 'user_id', 'user_email']);
      }
    } finally {
      clearTimeout(timeoutId);
      set({ isRefreshingProfile: false });
      // Clear storage state for cross-component sync
      await chrome.storage.local.set({ is_refreshing_entitlements: false });
    }
  },
  refreshConnection: async () => {
    try {
      const { session_token } = await chrome.storage.local.get(['session_token']);

      if (!session_token) {
        set({
          isConnected: false,
          isPro: false,
          plan: 'free',
          purchaseType: undefined,
          subscriptionSource: undefined,
          subscriptionExpiresAt: undefined,
        });
        return;
      }

      // hasTriedInitialLoad is obsolete - remove it if present
      const { hasTriedInitialLoad } = await chrome.storage.local.get(['hasTriedInitialLoad']);
      if (hasTriedInitialLoad) {
        await chrome.storage.local.remove(['hasTriedInitialLoad']);
      }

      set({ hasTriedInitialLoad: false });

      await get().refreshEntitlements();
    } catch (error) {
      console.error('Failed to refresh connection state:', error);
    }
  },
  saveSyncSettings: async (nextIntervalHours?: number) => {
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
        enabled: true,
        intervalHours: interval,
      });
    }
  },

  getEffectiveLimits: () => ({
    minIntervalHours: get().isPro ? PRO_MIN_INTERVAL_HOURS : FREE_INTERVAL_HOURS,
  }),
  getPricing: () => {
    return get().pricing;
  },
}));

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

      if (changes[CACHE_KEYS.session_token]) {
        const oldToken = changes[CACHE_KEYS.session_token].oldValue;
        const newToken = changes[CACHE_KEYS.session_token].newValue;
        const wasConnected = useAppStore.getState().isConnected;
        const isNowConnected = !!newToken;
        const sessionChanged = !!newToken && oldToken !== newToken;
        const shouldClearDashboard = !newToken || sessionChanged;

        useAppStore.setState({
          isConnected: isNowConnected,
          ...(shouldClearDashboard ? { dashboard: undefined } : {}),
        });
        if (shouldClearDashboard) void chrome.storage.local.remove(CACHE_KEYS.dashboard_snapshot);

        if (newToken && (!oldToken || oldToken !== newToken)) {
          // hasTriedInitialLoad is obsolete - no longer needed
          useAppStore.setState({ hasTriedInitialLoad: false });
        }

        if (!wasConnected && isNowConnected) {
          useAppStore.getState().refreshEntitlements();
        }
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
      if (changes['is_refreshing_entitlements']) {
        useAppStore.setState({
          isRefreshingProfile: !!changes['is_refreshing_entitlements'].newValue,
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
        useAppStore.setState(
          deployment?.apiOrigin === productConfig.apiUrl ? deployment : defaultDeployment
        );
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
