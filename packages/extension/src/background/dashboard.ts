import type {
  DashboardEvent,
  DashboardSnapshot,
  DashboardSyncResult,
  StoredSyncSummary,
} from '../dashboard/types';
import { analyzeBookmarkLibrary } from '../dashboard/library-health';
import { getReadingListItems } from '../utils/reading-list';
import { getAutoSyncStatus } from './auto-sync';
import { notionApi } from '../destinations/notion/notion-api';
import {
  NOTION_DATABASE_KEY,
  NOTION_TOKEN_KEY,
  readDestinationContext,
  readNotionConnectionFrom,
  assertDestinationContextCurrent,
  withCurrentDestination,
  isStaleDestinationStateError,
  type DestinationContext,
} from '../utils/destination-state';

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

// Activity belongs to the connection that started the operation. Drop it when the
// user disconnected or switched databases while the operation ran.
export async function recordDestinationActivity(
  context: DestinationContext,
  record: () => Promise<void>
): Promise<void> {
  try {
    await withCurrentDestination(context, record);
  } catch (error) {
    if (!isStaleDestinationStateError(error)) throw error;
  }
}

export function classifyDashboardError(error: unknown): DashboardEvent['errorCategory'] {
  const value = error instanceof Error ? error.message : String(error);
  const normalized = value.toLowerCase();
  if (/401|unauthor|token|auth/.test(normalized)) return 'authentication';
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

/**
 * Connection status from the stored token and database. A refresh asks Notion whether the
 * token can still open the database; the result is cached to keep the dashboard cheap.
 */
async function readConnection(
  refresh: boolean,
  context: DestinationContext
): Promise<DashboardSnapshot['connection']> {
  const stored = await chrome.storage.local.get([
    NOTION_TOKEN_KEY,
    NOTION_DATABASE_KEY,
    DASHBOARD_CONNECTION_KEY,
  ]);
  const connection = readNotionConnectionFrom(stored);
  if (!connection) return { status: 'disconnected', action: 'connect' };

  const names = {
    workspaceName: connection.database.workspaceName,
    databaseName: connection.database.title,
  };
  const cached = stored[DASHBOARD_CONNECTION_KEY] as CachedConnection | undefined;
  const cacheWindow =
    cached?.action === 'retry' ? CONNECTION_FAILURE_BACKOFF_MS : CONNECTION_CACHE_MS;
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt) < cacheWindow;
  if (!refresh) {
    if (fresh && cached.status !== 'connected') return { ...cached, ...names };
    // Without a fresh failure, trust the stored connection until the user refreshes.
    return { status: 'connected', ...names, checkedAt: cached?.checkedAt };
  }

  const checkedAt = new Date().toISOString();
  try {
    await notionApi.verifyDatabaseAccess(connection.database.id, connection.token);
    const connected: CachedConnection = { status: 'connected', ...names, checkedAt };
    await withCurrentDestination(context, async () => {
      await chrome.storage.local.set({ [DASHBOARD_CONNECTION_KEY]: connected });
      await recordDashboardEvent({ kind: 'connection_checked', result: 'success' });
    });
    return connected;
  } catch (error) {
    if (isStaleDestinationStateError(error)) throw error;
    await assertDestinationContextCurrent(context);
    const status = (error as { status?: unknown } | null)?.status;
    // A rejected token or a database the token cannot open needs a new connection.
    const action = status === 401 || status === 403 || status === 404 ? 'reconnect' : 'retry';
    const degraded: CachedConnection = { status: 'degraded', ...names, checkedAt, action };
    await withCurrentDestination(context, async () => {
      await chrome.storage.local.set({ [DASHBOARD_CONNECTION_KEY]: degraded });
      await recordDashboardEvent({
        kind: 'connection_checked',
        result: 'failed',
        errorCategory: classifyDashboardError(error),
        action,
      });
    });
    return degraded;
  }
}

export async function getDashboardSnapshot(refreshConnection = false): Promise<DashboardSnapshot> {
  const context = await readDestinationContext();
  const connection = await readConnection(refreshConnection, context);
  const bookmarkTree = await chrome.bookmarks.getTree().catch(() => []);
  const [stored, readingList, autoSync] = await Promise.all([
    chrome.storage.local.get([
      'sync_in_progress',
      'last_sync',
      'last_sync_summary',
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
    },
    recentActivity: events,
  };
  await withCurrentDestination(context, () =>
    chrome.storage.local.set({ dashboard_snapshot: { ...snapshot, recentActivity: [] } })
  );
  return snapshot;
}
