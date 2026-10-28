/// <reference types="chrome" />
/// <reference types="vite/client" />
import {
  DESTINATION_REVISION_KEY,
  NOTION_DATABASE_KEY,
  readDestinationContext,
  isDestinationContextCurrent,
  isStaleDestinationStateError,
  StaleDestinationStateError,
  sameDestinationContext,
  type DestinationContext,
} from '../utils/destination-state';
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { CACHE_KEYS, WATCHED_CACHE_KEYS } from '../utils/cache';
import { sendMessage, Messages } from '../utils/message';
import type { DashboardSnapshot } from '../dashboard/types';

// Scheduled sync runs at most every six hours; Notion allows about three requests a second.
export const MIN_SYNC_INTERVAL_HOURS = 6;
const DEFAULT_SYNC_INTERVAL_HOURS = 24;
// Leave room for a full Notion sync plus its error handling and response delivery.
const SYNC_MESSAGE_TIMEOUT_MS = 10 * 60_000 + 30_000;
let dashboardRefreshRequest: { context: DestinationContext; promise: Promise<void> } | null = null;
let autoSyncUpdateId = 0;

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
  version: string;
  /** A Notion database is connected with a token. */
  isConnected: boolean;
  isSyncing: boolean;
  isOptionsInitialized: boolean;
  hydrationState: HydrationState;
  bookmarkCount: number;
  lastSync: string;
  setIsSyncing: (v: boolean) => void;
  dashboard?: DashboardSnapshot;
  isDashboardLoading: boolean;
  refreshDashboard: (refreshConnection?: boolean) => Promise<void>;
  syncNow: () => Promise<{ noChanges: boolean }>;

  lastSyncSummary?: {
    type: 'success' | 'no_changes' | 'error';
    message?: string;
  };
  setLastSyncSummary: (summary?: AppState['lastSyncSummary']) => void;

  autoSync: boolean;
  intervalHours: number;
  setAutoSync: (v: boolean) => Promise<void>;
  setIntervalHours: (v: number) => void;

  initFromStorage: () => Promise<void>;
  saveSyncSettings: (nextIntervalHours?: number) => Promise<void>;
};

export const useAppStore = create<AppState>((set, get) => ({
  version: '',
  isConnected: false,
  isSyncing: false,
  isOptionsInitialized: false,
  hydrationState: 'booting',
  bookmarkCount: 0,
  lastSync: '',
  lastSyncSummary: undefined,
  dashboard: undefined,
  isDashboardLoading: false,
  setIsSyncing: (v: boolean) => set({ isSyncing: v }),
  setLastSyncSummary: (summary) => set({ lastSyncSummary: summary }),
  refreshDashboard: async (refreshConnection = false) => {
    const context = await readDestinationContext();
    const existing = dashboardRefreshRequest;
    if (existing && sameDestinationContext(existing.context, context) && !refreshConnection)
      return existing.promise;
    set({ isDashboardLoading: true });
    const request = (async () => {
      try {
        const response = await sendMessage(
          { type: Messages.GET_DASHBOARD_STATE, refreshConnection },
          { timeoutMs: 35_000 }
        );
        if (!(await isDestinationContextCurrent(context))) return;
        if (response.success && response.dashboard) {
          set({ ...dashboardState(response.dashboard), hydrationState: 'fresh' });
        }
      } catch (error) {
        if (await isDestinationContextCurrent(context))
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

    const contextRequest = readDestinationContext();
    set({ isSyncing: true });
    let context: DestinationContext | undefined;
    try {
      context = await contextRequest;
      const response = await sendMessage(
        { type: Messages.SYNC_ALL_BOOKMARKS, destinationRevision: context.revision },
        { timeoutMs: SYNC_MESSAGE_TIMEOUT_MS }
      );
      if (!(await isDestinationContextCurrent(context))) throw new StaleDestinationStateError();
      if (!response?.success) throw new Error(response?.error || 'SYNC_FAILED');

      await get().refreshDashboard(false);
      return { noChanges: response.noChanges === true };
    } catch (error) {
      if (isStaleDestinationStateError(error)) throw error;
      // Refresh once on failure so the dashboard shows the stored error state.
      void get().refreshDashboard(false);
      throw error;
    } finally {
      if (!context || (await isDestinationContextCurrent(context))) set({ isSyncing: false });
    }
  },

  autoSync: false,
  intervalHours: DEFAULT_SYNC_INTERVAL_HOURS,
  setAutoSync: async (v: boolean) => {
    const context = await readDestinationContext();
    const requestId = ++autoSyncUpdateId;
    set({ autoSync: v });
    if (!(await isDestinationContextCurrent(context)) || requestId !== autoSyncUpdateId) return;
    await sendMessage({
      type: Messages.SCHEDULE_AUTO_SYNC,
      destinationRevision: context.revision,
      enabled: v,
      intervalHours: get().intervalHours,
    });
  },
  setIntervalHours: (v: number) => set({ intervalHours: v }),

  initFromStorage: async () => {
    try {
      const stored = await chrome.storage.local.get([
        NOTION_DATABASE_KEY,
        'last_sync',
        'sync_interval_hours',
        'sync_in_progress',
        CACHE_KEYS.dashboard_snapshot,
      ]);
      const interval = Number(stored.sync_interval_hours);
      const cachedDashboard = isDashboardSnapshot(stored[CACHE_KEYS.dashboard_snapshot])
        ? stored[CACHE_KEYS.dashboard_snapshot]
        : undefined;
      set({
        isConnected: !!stored[NOTION_DATABASE_KEY],
        isSyncing: !!stored.sync_in_progress,
        dashboard: cachedDashboard,
        bookmarkCount: cachedDashboard?.library.bookmarks ?? get().bookmarkCount,
        lastSync:
          typeof stored.last_sync === 'string'
            ? stored.last_sync
            : cachedDashboard?.sync.lastSyncAt || '',
        autoSync: cachedDashboard?.sync.autoSyncEnabled ?? false,
        intervalHours: Math.max(
          MIN_SYNC_INTERVAL_HOURS,
          Number.isFinite(interval) ? interval : DEFAULT_SYNC_INTERVAL_HOURS
        ),
        hydrationState: 'cached',
      });
    } catch (error) {
      console.error('❌ Failed to initialize from storage:', error);
      set({ hydrationState: 'cached' });
    }
  },

  saveSyncSettings: async (nextIntervalHours?: number) => {
    const context = await readDestinationContext();
    const raw = typeof nextIntervalHours === 'number' ? nextIntervalHours : get().intervalHours;
    const interval = Math.max(MIN_SYNC_INTERVAL_HOURS, Math.floor(raw * 100) / 100);
    await chrome.storage.local.set({
      sync_interval_hours: interval,
      auto_sync_interval_minutes: Math.round(interval * 60),
    });
    set({ intervalHours: interval });

    if (get().autoSync) {
      await sendMessage({
        type: Messages.SCHEDULE_AUTO_SYNC,
        destinationRevision: context.revision,
        enabled: true,
        intervalHours: interval,
      });
    }
  },
}));

/**
 * Applies a new, switched or removed Notion connection. Work and dashboard data from the
 * previous connection no longer apply.
 */
function handleDestinationChange(changes: { [key: string]: chrome.storage.StorageChange }) {
  const isConnected = !!(changes[NOTION_DATABASE_KEY]
    ? changes[NOTION_DATABASE_KEY].newValue
    : useAppStore.getState().isConnected);
  autoSyncUpdateId++;
  dashboardRefreshRequest = null;
  useAppStore.setState({
    isConnected,
    isDashboardLoading: false,
    dashboard: undefined,
    isSyncing: false,
    lastSync: '',
    ...(isConnected ? {} : { autoSync: false }),
  });
  void chrome.storage.local.remove(CACHE_KEYS.dashboard_snapshot);
  void useAppStore.getState().refreshDashboard(false);
}

// Thin provider to run init effects and listeners
export function AppProvider({ children }: { children: ReactNode }) {
  const initialized = useRef(false);
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
      if (!WATCHED_CACHE_KEYS.some((key) => key in changes)) return;

      if (changes[DESTINATION_REVISION_KEY] || changes[NOTION_DATABASE_KEY]) {
        handleDestinationChange(changes);
      }
      if (changes['last_sync']) {
        const s = changes['last_sync'].newValue as string | undefined;
        useAppStore.setState({ lastSync: s || '' });
      }
      if (changes[CACHE_KEYS.last_sync_summary]) {
        const summary = changes[CACHE_KEYS.last_sync_summary].newValue as string | undefined;
        if (summary === 'no_changes') {
          useAppStore.setState({
            lastSyncSummary: { type: 'no_changes', message: 'Everything is up to date' },
          });
        } else if (!summary) {
          useAppStore.setState({ lastSyncSummary: undefined });
        }
      }
      if (changes['sync_in_progress']) {
        useAppStore.setState({ isSyncing: !!changes['sync_in_progress'].newValue });
      }
      if (changes['auto_sync_enabled']) {
        useAppStore.setState({ autoSync: !!changes['auto_sync_enabled'].newValue });
      }
      if (changes['auto_sync_interval_minutes']) {
        const minutes = changes['auto_sync_interval_minutes'].newValue as number | undefined;
        if (minutes) useAppStore.setState({ intervalHours: minutes / 60 });
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

  // Load local cached state only; the destination page requests fresh data when mounted.
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
