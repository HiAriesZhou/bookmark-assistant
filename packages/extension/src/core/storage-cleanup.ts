export interface PartialSyncInfo {
  new_count?: number;
  failed_count?: number;
  total_synced?: number;
  message?: string;
}

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

function parsePartialSyncInfo(info: unknown): unknown {
  if (typeof info !== 'string') {
    return info;
  }

  return JSON.parse(info);
}

export function validatePartialSyncInfo(info: unknown): PartialSyncInfo | null {
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    return null;
  }

  const source = info as Record<string, unknown>;
  const validated: PartialSyncInfo = {};

  if ('new_count' in source) {
    const value = Number(source.new_count);
    validated.new_count = Number.isFinite(value) ? value : 0;
  }

  if ('failed_count' in source) {
    const value = Number(source.failed_count);
    validated.failed_count = Number.isFinite(value) ? value : 0;
  }

  if ('total_synced' in source) {
    const value = Number(source.total_synced);
    validated.total_synced = Number.isFinite(value) ? value : 0;
  }

  if (typeof source.message === 'string') {
    validated.message = source.message;
  }

  return validated;
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

  if ('last_sync_hash' in storage) {
    removeKeys.push('last_sync_hash');
  }

  if ('hasTriedInitialLoad' in storage) {
    removeKeys.push('hasTriedInitialLoad');
  }

  if ('last_sync_partial_info' in storage) {
    try {
      const partialInfo = parsePartialSyncInfo(storage.last_sync_partial_info);
      const validated = validatePartialSyncInfo(partialInfo);

      if (validated) {
        updateValues.last_sync_partial_info = validated;
      } else {
        removeKeys.push('last_sync_partial_info');
      }
    } catch {
      removeKeys.push('last_sync_partial_info');
    }
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
