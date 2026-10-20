export interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, unknown>;
  userAgent: string;
  version: string;
}

export interface CleanErrorReportsOptions {
  now?: number | Date;
  retentionMs?: number;
  maxReports?: number;
}

export type PlanStorageCleanupOptions = CleanErrorReportsOptions;

export interface StorageCleanupPlan {
  removeKeys: string[];
  updateValues: Record<string, unknown>;
}

const DEFAULT_ERROR_RETENTION_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX_ERROR_REPORTS = 10;

function getNowMs(now: CleanErrorReportsOptions['now']): number {
  if (now instanceof Date) {
    return now.getTime();
  }

  if (typeof now === 'number' && Number.isFinite(now)) {
    return now;
  }

  return Date.now();
}

export function cleanErrorReports(
  errorReports: unknown,
  options: CleanErrorReportsOptions = {}
): ErrorReport[] {
  if (!Array.isArray(errorReports)) {
    return [];
  }

  const now = getNowMs(options.now);
  const retentionMs = options.retentionMs ?? DEFAULT_ERROR_RETENTION_MS;
  const maxReports = options.maxReports ?? DEFAULT_MAX_ERROR_REPORTS;
  const cutoff = now - retentionMs;

  return errorReports
    .filter((report): report is ErrorReport => {
      if (!report || typeof report !== 'object') {
        return false;
      }

      const timestamp = new Date((report as { timestamp?: unknown }).timestamp as string).getTime();
      return Number.isFinite(timestamp) && timestamp > cutoff;
    })
    .slice(-maxReports);
}

export function planStorageCleanup(
  storage: Record<string, unknown>,
  options: PlanStorageCleanupOptions = {}
): StorageCleanupPlan {
  const removeKeys: string[] = [];
  const updateValues: Record<string, unknown> = {};

  for (const key of [
    'page_description_cache',
    'is_refreshing_entitlements',
    'last_sync_hash',
    'hasTriedInitialLoad',
    'last_sync_partial_info',
  ]) {
    if (key in storage) removeKeys.push(key);
  }

  if ('error_reports' in storage) {
    const cleanedErrors = cleanErrorReports(storage.error_reports, options);
    const hasMalformedReports = !Array.isArray(storage.error_reports);
    const originalReportCount = Array.isArray(storage.error_reports)
      ? storage.error_reports.length
      : 0;

    if (hasMalformedReports || cleanedErrors.length !== originalReportCount) {
      updateValues.error_reports = cleanedErrors;
    }
  }

  return { removeKeys, updateValues };
}
