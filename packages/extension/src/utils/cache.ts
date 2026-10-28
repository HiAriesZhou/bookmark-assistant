import type { DashboardEvent, DashboardSnapshot, StoredSyncSummary } from '../dashboard/types';
import type { NotionDatabaseRef } from './destination-state';

/** Local keys the options page reads. The Notion token itself is read only by the background. */
export interface ChromeLocalCache {
  notion_database?: NotionDatabaseRef;
  destination_revision?: string;

  sync_in_progress?: boolean;
  last_sync?: string; // ISO timestamp (legacy key name)
  last_sync_at?: string; // ISO timestamp
  last_sync_summary?: string; // Summary of last sync (no_changes, error, etc.)
  last_sync_count?: number;
  last_sync_fingerprint?: string;
  dashboard_last_sync?: StoredSyncSummary;
  dashboard_recent_activity?: DashboardEvent[];
  dashboard_saved_today?: { date: string; count: number };
  dashboard_snapshot?: DashboardSnapshot;

  auto_sync_enabled?: boolean; // Primary auto-sync state
  auto_sync_interval_minutes?: number; // Primary interval (in minutes)
  sync_interval_hours?: number; // UI-friendly interval cache (optional)
}

export const CACHE_KEYS = {
  notion_database: 'notion_database',
  destination_revision: 'destination_revision',

  sync_in_progress: 'sync_in_progress',
  last_sync: 'last_sync',
  last_sync_at: 'last_sync_at',
  last_sync_summary: 'last_sync_summary',
  last_sync_count: 'last_sync_count',
  last_sync_fingerprint: 'last_sync_fingerprint',
  dashboard_last_sync: 'dashboard_last_sync',
  dashboard_recent_activity: 'dashboard_recent_activity',
  dashboard_saved_today: 'dashboard_saved_today',
  dashboard_snapshot: 'dashboard_snapshot',

  auto_sync_enabled: 'auto_sync_enabled',
  auto_sync_interval_minutes: 'auto_sync_interval_minutes',
  sync_interval_hours: 'sync_interval_hours',
} as const;

export const WATCHED_CACHE_KEYS = [
  CACHE_KEYS.notion_database,
  CACHE_KEYS.destination_revision,
  CACHE_KEYS.sync_in_progress,
  CACHE_KEYS.last_sync,
  CACHE_KEYS.last_sync_at,
  CACHE_KEYS.last_sync_summary,
  CACHE_KEYS.last_sync_count,
  CACHE_KEYS.last_sync_fingerprint,
  CACHE_KEYS.dashboard_last_sync,
  CACHE_KEYS.dashboard_recent_activity,
  CACHE_KEYS.dashboard_saved_today,
  CACHE_KEYS.dashboard_snapshot,
  CACHE_KEYS.auto_sync_enabled,
  CACHE_KEYS.auto_sync_interval_minutes,
] as const;

export type CacheKey = keyof typeof CACHE_KEYS;
