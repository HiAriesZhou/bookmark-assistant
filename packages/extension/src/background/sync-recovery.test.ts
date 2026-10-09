import { describe, expect, it, vi } from 'vitest';
import {
  INTERRUPTED_SYNC_ERROR,
  canCommitSyncFingerprint,
  createSyncExecutionGate,
  recoverInterruptedSyncState,
  runAfterSyncInitialization,
} from './sync-recovery';

describe('recoverInterruptedSyncState', () => {
  it('never commits a fingerprint for a server-deferred partial sync', () => {
    expect(canCommitSyncFingerprint({ failed: 0, deferred: 1 })).toBe(false);
    expect(canCommitSyncFingerprint({ failed: 0, partialSkipped: 1 })).toBe(false);
    expect(canCommitSyncFingerprint({ failed: 0 })).toBe(true);
  });

  it('releases a sync left behind by an earlier service worker', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ sync_in_progress: true, sync_trigger: 'auto' }),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as chrome.storage.StorageArea;

    await expect(recoverInterruptedSyncState(storage, () => 0)).resolves.toEqual({
      trigger: 'auto',
    });
    expect(storage.set).toHaveBeenCalledWith({
      sync_in_progress: false,
      sync_started_at: null,
      sync_trigger: null,
      last_sync_error: INTERRUPTED_SYNC_ERROR,
      dashboard_last_sync: {
        result: 'failed',
        completedAt: '1970-01-01T00:00:00.000Z',
        total: 0,
        success: 0,
        failed: 1,
        skipped: 0,
      },
    });
  });

  it('does not overwrite an idle sync state', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ sync_in_progress: false }),
      set: vi.fn(),
    } as unknown as chrome.storage.StorageArea;

    await expect(recoverInterruptedSyncState(storage)).resolves.toBeNull();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('waits for startup recovery before allowing a new sync to start', async () => {
    let finishInitialization: (() => void) | undefined;
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const startSync = vi.fn().mockResolvedValue('started');

    const pending = runAfterSyncInitialization(initialization, startSync);
    await Promise.resolve();

    expect(startSync).not.toHaveBeenCalled();
    finishInitialization?.();
    await expect(pending).resolves.toBe('started');
    expect(startSync).toHaveBeenCalledTimes(1);
  });

  it('recovers legacy state without inventing a manual trigger', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ sync_in_progress: true }),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as chrome.storage.StorageArea;

    await expect(recoverInterruptedSyncState(storage)).resolves.toEqual({});
  });

  it('joins concurrent sync triggers after startup recovery', async () => {
    let finishInitialization: (() => void) | undefined;
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const run = vi.fn().mockResolvedValue({ success: true });
    const gate = createSyncExecutionGate(initialization);

    const manual = gate(run);
    const automatic = gate(run);
    expect(run).not.toHaveBeenCalled();

    finishInitialization?.();
    await expect(Promise.all([manual, automatic])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
