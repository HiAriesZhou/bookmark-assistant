import type { StoredSyncSummary } from '../dashboard/types';

export const INTERRUPTED_SYNC_ERROR = 'A previous sync was interrupted. Please try again.';

export type SyncTrigger = 'manual' | 'auto';

export interface RecoveredSyncState {
  trigger?: SyncTrigger;
}

type SyncStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

/** A fingerprint is proof of a complete server application, never a partial one. */
export function canCommitSyncFingerprint(input: {
  failed: number;
  deferred?: number;
  partialSkipped?: number;
}): boolean {
  return input.failed === 0 && (input.deferred || 0) === 0 && (input.partialSkipped || 0) === 0;
}

/**
 * A new MV3 service worker cannot resume a request started by an earlier
 * worker. Clear the durable in-progress marker immediately so users can retry
 * instead of being locked out until another restart happens after a timeout.
 */
export async function recoverInterruptedSyncState(
  storage: SyncStorage,
  now: () => number = Date.now
): Promise<RecoveredSyncState | null> {
  const { sync_in_progress, sync_trigger } = await storage.get([
    'sync_in_progress',
    'sync_trigger',
  ]);
  if (sync_in_progress !== true) return null;

  const completedAt = new Date(now()).toISOString();
  const summary: StoredSyncSummary = {
    result: 'failed',
    completedAt,
    total: 0,
    success: 0,
    failed: 1,
    skipped: 0,
  };
  await storage.set({
    sync_in_progress: false,
    sync_started_at: null,
    sync_trigger: null,
    last_sync_error: INTERRUPTED_SYNC_ERROR,
    dashboard_last_sync: summary,
  });
  return sync_trigger === 'manual' || sync_trigger === 'auto' ? { trigger: sync_trigger } : {};
}

/**
 * Keep every sync entry point behind the same startup recovery promise. This
 * prevents a newly started sync from being mistaken for state left by an older
 * MV3 service worker.
 */
export async function runAfterSyncInitialization<T>(
  initialization: Promise<unknown>,
  task: () => Promise<T>
): Promise<T> {
  await initialization;
  return task();
}

/**
 * A service worker has no durable mutex. Keep all sync entry points behind one
 * in-memory promise after startup recovery has released stale persisted state.
 * Concurrent manual/alarm/catch-up calls join the same work rather than
 * creating duplicate Notion writes.
 */
export function createSyncExecutionGate<T>(initialization: Promise<unknown>) {
  const active = new Map<string, Promise<T>>();

  return (task: () => Promise<T>, accountKey = ''): Promise<T> => {
    const existing = active.get(accountKey);
    if (existing) return existing;
    const started = runAfterSyncInitialization(initialization, task);
    const guarded = started.finally(() => {
      if (active.get(accountKey) === guarded) active.delete(accountKey);
    });
    active.set(accountKey, guarded);
    return guarded;
  };
}
