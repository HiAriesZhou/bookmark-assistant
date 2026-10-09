/**
 * Keep a sync response inside the serverless execution window. Description
 * extraction is optional, so it must yield before base Notion writes lose their
 * time budget.
 */
export type SyncTimeBudgetOptions = {
  startedAt: number;
  now: () => number;
  requestBudgetMs: number;
  descriptionBudgetMs: number;
  reserveForBaseSyncMs: number;
};

export function canStartDescriptionExtraction({
  startedAt,
  now,
  requestBudgetMs,
  descriptionBudgetMs,
  reserveForBaseSyncMs,
}: SyncTimeBudgetOptions): boolean {
  const elapsedMs = Math.max(0, now() - startedAt);
  const allowedDescriptionMs = Math.max(
    0,
    Math.min(descriptionBudgetMs, requestBudgetMs - reserveForBaseSyncMs)
  );
  return elapsedMs < allowedDescriptionMs;
}

export function remainingBaseSyncBudgetMs({
  startedAt,
  now,
  requestBudgetMs,
}: Pick<SyncTimeBudgetOptions, 'startedAt' | 'now' | 'requestBudgetMs'>): number {
  return Math.max(0, requestBudgetMs - Math.max(0, now() - startedAt));
}

/**
 * Required Notion writes must stop early enough for the route to serialize a
 * useful response. Unlike description extraction, a write that has not yet
 * started is safe to defer and retry on the next idempotent sync request.
 */
export function canStartNotionWrite({
  startedAt,
  now,
  requestBudgetMs,
  reserveForResponseMs = 10_000,
}: Pick<SyncTimeBudgetOptions, 'startedAt' | 'now' | 'requestBudgetMs'> & {
  reserveForResponseMs?: number;
}): boolean {
  const remainingMs = remainingBaseSyncBudgetMs({ startedAt, now, requestBudgetMs });
  return remainingMs > Math.max(0, reserveForResponseMs);
}
