import {
  readAccountContext,
  withCurrentAccount,
  isAccountContextCurrent,
  isStaleAccountStateError,
  type AccountContext,
} from '../utils/account-state';
/// <reference types="chrome" />

import {
  serverAPI,
  type BookmarkSyncEnrichmentItem,
  type BookmarkSyncEnrichmentResponse,
} from './server-api';

export const SYNC_ENRICHMENT_JOB_KEY = 'sync_enrichment_job';
export const SYNC_ENRICHMENT_STATE_KEY = 'sync_enrichment_state';
export const SYNC_ENRICHMENT_ALARM = 'bookmark-sync-enrichment';

export type SyncEnrichmentState = {
  status: 'pending' | 'processing' | 'retrying' | 'completed';
  total: number;
  updatedAt: string;
  completedAt?: string;
  generated?: number;
  alreadyPresent?: number;
  unavailable?: number;
  targetSkipped?: number;
  failed?: number;
  aiPlanning?: BookmarkSyncEnrichmentResponse['aiPlanning'];
  lastError?: string;
};

type SyncEnrichmentJob = {
  id: string;
  items: BookmarkSyncEnrichmentItem[];
  aiBatchEligible?: boolean;
  attempts: number;
  createdAt: string;
};

let activeRun: Promise<void> | undefined;

function jobId(): string {
  return globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `enrichment-${Date.now()}`;
}

function mergeItems(
  existing: BookmarkSyncEnrichmentItem[],
  incoming: BookmarkSyncEnrichmentItem[]
): BookmarkSyncEnrichmentItem[] {
  const merged = new Map(existing.map((item) => [item.syncId, item]));
  for (const item of incoming) merged.set(item.syncId, item);
  return [...merged.values()];
}

async function scheduleRetry(attempts: number): Promise<void> {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attempts, 5)));
  await chrome.alarms.create(SYNC_ENRICHMENT_ALARM, { delayInMinutes: delayMinutes });
}

export async function enqueueSyncEnrichment(
  input: {
    items: BookmarkSyncEnrichmentItem[];
    aiBatchEligible?: boolean;
  },
  expectedContext?: AccountContext
): Promise<void> {
  if (!input.items.length) return;
  const context = expectedContext ?? (await readAccountContext());
  await withCurrentAccount(context, async () => {
    const stored = await chrome.storage.local.get(SYNC_ENRICHMENT_JOB_KEY);
    const current = stored[SYNC_ENRICHMENT_JOB_KEY] as SyncEnrichmentJob | undefined;
    const now = new Date().toISOString();
    const job: SyncEnrichmentJob = {
      id: jobId(),
      items: mergeItems(current?.items || [], input.items),
      aiBatchEligible: input.aiBatchEligible,
      attempts: current?.attempts || 0,
      createdAt: current?.createdAt || now,
    };
    await chrome.storage.local.set({
      [SYNC_ENRICHMENT_JOB_KEY]: job,
      [SYNC_ENRICHMENT_STATE_KEY]: {
        status: 'pending',
        total: job.items.length,
        updatedAt: now,
      } satisfies SyncEnrichmentState,
    });
    await chrome.alarms.create(SYNC_ENRICHMENT_ALARM, { when: Date.now() + 1_000 });
  });
  void processPendingSyncEnrichment();
}

export function processPendingSyncEnrichment(): Promise<void> {
  if (activeRun) return activeRun;
  activeRun = drainPendingSyncEnrichment().finally(() => {
    activeRun = undefined;
  });
  return activeRun;
}

async function readStoredJob(): Promise<SyncEnrichmentJob | undefined> {
  const stored = await chrome.storage.local.get(SYNC_ENRICHMENT_JOB_KEY);
  const job = stored[SYNC_ENRICHMENT_JOB_KEY] as SyncEnrichmentJob | undefined;
  return job?.items?.length ? job : undefined;
}

// Callers that arrive during a run join it, so a job queued meanwhile (or by a
// new account) is picked up here instead of waiting for a worker restart. The
// same job left behind for retry waits for its alarm.
async function drainPendingSyncEnrichment(): Promise<void> {
  let processed = await runPendingSyncEnrichment();
  while (processed) {
    const latest = await readStoredJob();
    if (!latest || latest.id === processed) return;
    processed = await runPendingSyncEnrichment();
  }
}

async function runPendingSyncEnrichment(): Promise<string | undefined> {
  const context = await readAccountContext();
  const job = await readStoredJob();
  if (!job) return undefined;
  try {
    const startedAt = new Date().toISOString();
    await withCurrentAccount(context, () =>
      chrome.storage.local.set({
        [SYNC_ENRICHMENT_STATE_KEY]: {
          status: 'processing',
          total: job.items.length,
          updatedAt: startedAt,
        } satisfies SyncEnrichmentState,
      })
    );

    const response = await serverAPI.enrichBookmarks(
      {
        items: job.items,
        aiBatchEligible: job.aiBatchEligible,
      },
      context
    );
    await withCurrentAccount(context, async () => {
      const latest = (await chrome.storage.local.get(SYNC_ENRICHMENT_JOB_KEY))[
        SYNC_ENRICHMENT_JOB_KEY
      ] as SyncEnrichmentJob | undefined;
      if (latest?.id !== job.id) return;
      await chrome.alarms.clear(SYNC_ENRICHMENT_ALARM);
      await chrome.storage.local.remove(SYNC_ENRICHMENT_JOB_KEY);
      const completedAt = new Date().toISOString();
      await chrome.storage.local.set({
        [SYNC_ENRICHMENT_STATE_KEY]: {
          status: 'completed',
          total: response.summary.total,
          generated: response.summary.generated,
          alreadyPresent: response.summary.alreadyPresent,
          unavailable: response.summary.unavailable,
          targetSkipped: response.summary.targetSkipped,
          failed: response.summary.failed,
          aiPlanning: response.aiPlanning,
          updatedAt: completedAt,
          completedAt,
        } satisfies SyncEnrichmentState,
      });
    });
  } catch (error) {
    if (isStaleAccountStateError(error) || !(await isAccountContextCurrent(context))) return job.id;
    await withCurrentAccount(context, async () => {
      const latest = (await chrome.storage.local.get(SYNC_ENRICHMENT_JOB_KEY))[
        SYNC_ENRICHMENT_JOB_KEY
      ] as SyncEnrichmentJob | undefined;
      if (latest?.id !== job.id) return;
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      await chrome.storage.local.set({
        [SYNC_ENRICHMENT_JOB_KEY]: { ...job, attempts },
        [SYNC_ENRICHMENT_STATE_KEY]: {
          status: 'retrying',
          total: job.items.length,
          updatedAt: new Date().toISOString(),
          lastError: message,
        } satisfies SyncEnrichmentState,
      });
      await scheduleRetry(attempts);
      console.warn('[Sync Enrichment] Deferred work will retry:', message);
    });
  }
  return job.id;
}

export function setupSyncEnrichmentRecovery(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ENRICHMENT_ALARM) void processPendingSyncEnrichment();
  });
  void processPendingSyncEnrichment();
}
