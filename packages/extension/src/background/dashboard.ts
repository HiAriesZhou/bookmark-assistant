import type {
  DashboardEvent,
  DashboardSnapshot,
  DashboardSyncResult,
  StoredSyncSummary,
} from '../dashboard/types';
import { analyzeBookmarkLibrary } from '../dashboard/library-health';
import { getReadingListItems } from '../utils/reading-list';
import { getAutoSyncStatus } from './auto-sync';
import { serverAPI } from './server-api';
import {
  hasNotionDestination,
  NOTION_CONNECTED_KEY,
  readAccountContext,
  assertAccountContextCurrent,
  withCurrentAccount,
  isStaleAccountStateError,
  type AccountContext,
} from '../utils/account-state';

export const DASHBOARD_EVENTS_KEY = 'dashboard_recent_activity';
export const DASHBOARD_SYNC_SUMMARY_KEY = 'dashboard_last_sync';
export const DASHBOARD_SAVED_TODAY_KEY = 'dashboard_saved_today';
const DASHBOARD_CONNECTION_KEY = 'dashboard_connection';
const MAX_EVENTS = 20;
const CONNECTION_CACHE_MS = 5 * 60 * 1000;
const CONNECTION_FAILURE_BACKOFF_MS = 30_000;

type CachedConnection = {
  status: 'connected' | 'degraded';
  workspaceName?: string;
  databaseName?: string;
  checkedAt: string;
  action?: 'reconnect' | 'retry';
};

function eventId(): string {
  return globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function keepRecentEvents(events: DashboardEvent[], max = MAX_EVENTS): DashboardEvent[] {
  return [...events]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, max);
}

export async function recordDashboardEvent(
  event: Omit<DashboardEvent, 'id' | 'occurredAt'> & { occurredAt?: string }
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DASHBOARD_EVENTS_KEY);
    const existing = Array.isArray(stored[DASHBOARD_EVENTS_KEY])
      ? (stored[DASHBOARD_EVENTS_KEY] as DashboardEvent[])
      : [];
    const next: DashboardEvent = {
      ...event,
      id: eventId(),
      occurredAt: event.occurredAt || new Date().toISOString(),
    };
    await chrome.storage.local.set({
      [DASHBOARD_EVENTS_KEY]: keepRecentEvents([next, ...existing]),
    });
  } catch (error) {
    console.warn('[Dashboard] Failed to record activity:', error);
  }
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function recordDashboardSave(source: 'current_page' | 'context_menu'): Promise<void> {
  await recordDashboardEvent({
    kind: 'save_completed',
    source,
    result: 'success',
    counts: { total: 1, success: 1, failed: 0, skipped: 0 },
  });
  try {
    const stored = await chrome.storage.local.get(DASHBOARD_SAVED_TODAY_KEY);
    const current = stored[DASHBOARD_SAVED_TODAY_KEY] as
      | { date: string; count: number }
      | undefined;
    const date = localDateKey();
    await chrome.storage.local.set({
      [DASHBOARD_SAVED_TODAY_KEY]: {
        date,
        count: current?.date === date && Number.isFinite(current.count) ? current.count + 1 : 1,
      },
    });
  } catch (error) {
    console.warn('[Dashboard] Failed to update daily save count:', error);
  }
}

// Activity belongs to the account that started the operation. Drop it when
// logout, deletion or a new connection completed while the operation ran.
export async function recordAccountActivity(
  context: AccountContext,
  record: () => Promise<void>
): Promise<void> {
  try {
    await withCurrentAccount(context, record);
  } catch (error) {
    if (!isStaleAccountStateError(error)) throw error;
  }
}

export function classifyDashboardError(error: unknown): DashboardEvent['errorCategory'] {
  const value = error instanceof Error ? error.message : String(error);
  const normalized = value.toLowerCase();
  if (/401|unauthor|session|auth/.test(normalized)) return 'authentication';
  if (/403|notion|database|permission|access/.test(normalized)) return 'notion_access';
  if (/429|rate|cooldown|limit/.test(normalized)) return 'rate_limit';
  if (/network|fetch|timeout|timed out|offline/.test(normalized)) return 'network';
  return 'unknown';
}

export function inferSyncResult(
  summary: Pick<StoredSyncSummary, 'failed' | 'success'> | undefined,
  error: unknown
): DashboardSyncResult {
  if (summary?.failed && summary.success) return 'partial_failure';
  return classifyDashboardError(error) === 'rate_limit' ? 'limited' : 'failed';
}

async function readConnection(
  refresh: boolean,
  context: AccountContext
): Promise<DashboardSnapshot['connection']> {
  const stored = await chrome.storage.local.get([
    'session_token',
    NOTION_CONNECTED_KEY,
    DASHBOARD_CONNECTION_KEY,
  ]);
  if (!hasNotionDestination(stored)) return { status: 'disconnected', action: 'connect' };

  const cached = stored[DASHBOARD_CONNECTION_KEY] as CachedConnection | undefined;
  const cacheWindow =
    cached?.action === 'retry' ? CONNECTION_FAILURE_BACKOFF_MS : CONNECTION_CACHE_MS;
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt) < cacheWindow;
  if (!refresh && fresh) {
    return cached.status === 'connected'
      ? cached
      : { ...cached, action: cached.action || 'reconnect' };
  }

  try {
    const { user } = await serverAPI.getUserProfile({}, context);
    const checkedAt = new Date().toISOString();
    const status = user.hasNotionAccess && user.hasNotionDatabase ? 'connected' : 'degraded';
    const connection: CachedConnection = {
      status,
      workspaceName: user.workspaceName || undefined,
      databaseName: user.databaseName || undefined,
      checkedAt,
      action: status === 'connected' ? undefined : 'reconnect',
    };
    await withCurrentAccount(context, async () => {
      await chrome.storage.local.set({ [DASHBOARD_CONNECTION_KEY]: connection });
      await recordDashboardEvent({
        kind: 'connection_checked',
        result: status === 'connected' ? 'success' : 'failed',
        action: status === 'connected' ? undefined : 'reconnect',
      });
    });
    return status === 'connected' ? connection : { ...connection, action: 'reconnect' };
  } catch (error) {
    if (isStaleAccountStateError(error)) throw error;
    await assertAccountContextCurrent(context);
    const checkedAt = new Date().toISOString();
    const errorCategory = classifyDashboardError(error);
    const action = errorCategory === 'authentication' ? 'connect' : 'retry';
    await withCurrentAccount(context, () =>
      recordDashboardEvent({
        kind: 'connection_checked',
        result: 'failed',
        errorCategory,
        action,
      })
    );
    if (errorCategory === 'authentication') {
      return { status: 'disconnected', checkedAt, action: 'connect' };
    }
    const degraded: CachedConnection = {
      ...cached,
      status: 'degraded',
      checkedAt,
      action: 'retry',
    };
    await withCurrentAccount(context, () =>
      chrome.storage.local.set({ [DASHBOARD_CONNECTION_KEY]: degraded })
    );
    return degraded;
  }
}

export async function getDashboardSnapshot(refreshConnection = false): Promise<DashboardSnapshot> {
  const context = await readAccountContext();
  const connection = await readConnection(refreshConnection, context);
  const bookmarkTree = await chrome.bookmarks.getTree().catch(() => []);
  const [stored, readingList, autoSync] = await Promise.all([
    chrome.storage.local.get([
      'sync_in_progress',
      'last_sync',
      'last_sync_summary',
      'sync_enrichment_state',
      DASHBOARD_SYNC_SUMMARY_KEY,
      DASHBOARD_EVENTS_KEY,
      DASHBOARD_SAVED_TODAY_KEY,
    ]),
    getReadingListItems({ fallbackBookmarkTree: bookmarkTree }).catch(() => []),
    getAutoSyncStatus().catch(() => ({
      enabled: false,
      intervalMinutes: null,
      nextScheduledTime: null,
    })),
  ]);
  const events = keepRecentEvents(
    Array.isArray(stored[DASHBOARD_EVENTS_KEY]) ? stored[DASHBOARD_EVENTS_KEY] : []
  );
  const today = localDateKey();
  const summary = stored[DASHBOARD_SYNC_SUMMARY_KEY] as StoredSyncSummary | undefined;
  const savedToday = stored[DASHBOARD_SAVED_TODAY_KEY] as
    | { date: string; count: number }
    | undefined;
  const legacyResult = stored.last_sync_summary === 'no_changes' ? 'no_changes' : undefined;
  const libraryHealth = analyzeBookmarkLibrary(bookmarkTree, readingList);

  const snapshot: DashboardSnapshot = {
    generatedAt: new Date().toISOString(),
    connection: {
      provider: { id: 'notion', displayName: 'Notion' },
      ...connection,
    },
    library: {
      bookmarks: libraryHealth.bookmarkCount,
      readingList: libraryHealth.readingListCount,
      savedToday:
        savedToday?.date === today && Number.isFinite(savedToday.count) ? savedToday.count : 0,
      duplicatesSkipped: summary?.skipped || 0,
    },
    libraryHealth,
    sync: {
      inProgress: stored.sync_in_progress === true,
      lastSyncAt: typeof stored.last_sync === 'string' ? stored.last_sync : summary?.completedAt,
      lastResult: summary?.result || legacyResult,
      nextAutoSyncAt: autoSync.nextScheduledTime
        ? new Date(autoSync.nextScheduledTime).toISOString()
        : undefined,
      autoSyncEnabled: autoSync.enabled,
      failedCount: summary?.failed || 0,
      enrichment: stored.sync_enrichment_state,
    },
    recentActivity: events,
  };
  await withCurrentAccount(context, () =>
    chrome.storage.local.set({ dashboard_snapshot: { ...snapshot, recentActivity: [] } })
  );
  return snapshot;
}
