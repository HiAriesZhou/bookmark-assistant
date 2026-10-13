// Canonical chrome.storage.local schema used by the extension
import type {
  DashboardEvent,
  DashboardSnapshot,
  StoredSyncSummary,
  SyncEnrichmentStatus,
} from '../dashboard/types';
import type { DeploymentProfile } from '@bookmark-assistant/types';

export interface ChromeLocalCache {
  // Auth/session
  session_token?: string;
  account_state_revision?: string;
  notion_connected?: boolean;
  user_id?: string;
  user_email?: string;
  oauth_template_database_id?: string; // Template database ID from OAuth (needed for reconnection)

  // Connection state
  is_connecting?: boolean;

  // Sync state
  sync_in_progress?: boolean;
  sync_enrichment_state?: SyncEnrichmentStatus;
  last_sync?: string; // ISO timestamp (legacy key name)
  last_sync_at?: string; // ISO timestamp
  last_sync_summary?: string; // Summary of last sync (no_changes, error, etc.)
  last_sync_count?: number;
  last_sync_fingerprint?: string;
  last_sync_hash?: string;
  dashboard_last_sync?: StoredSyncSummary;
  dashboard_recent_activity?: DashboardEvent[];
  dashboard_saved_today?: { date: string; count: number };
  dashboard_snapshot?: DashboardSnapshot;

  // Entitlements
  is_pro?: boolean;
  purchase_type?: 'monthly' | 'yearly';
  subscription_source?: 'paddle' | 'developer' | 'gift' | 'trial' | null;
  subscription_expires_at?: string | null;
  deployment_profile?: DeploymentProfile & { apiOrigin: string };

  // Settings
  auto_sync?: boolean; // Legacy UI state (deprecated, use auto_sync_enabled)
  auto_sync_enabled?: boolean; // Primary auto-sync state
  auto_sync_interval_minutes?: number; // Primary interval (in minutes)
  sync_interval_hours?: number; // UI-friendly interval cache (optional)

  // Pricing cache
  cached_pricing?: {
    monthly: number;
    yearly: number;
    schemaVersion?: number;
  };
}

// Optional: key literals for safer usage
export const CACHE_KEYS = {
  session_token: 'session_token',
  account_state_revision: 'account_state_revision',
  notion_connected: 'notion_connected',
  user_id: 'user_id',
  user_email: 'user_email',
  oauth_template_database_id: 'oauth_template_database_id',

  is_connecting: 'is_connecting',

  sync_in_progress: 'sync_in_progress',
  sync_enrichment_state: 'sync_enrichment_state',
  last_sync: 'last_sync',
  last_sync_at: 'last_sync_at',
  last_sync_summary: 'last_sync_summary',
  last_sync_count: 'last_sync_count',
  last_sync_fingerprint: 'last_sync_fingerprint',
  last_sync_hash: 'last_sync_hash',
  dashboard_last_sync: 'dashboard_last_sync',
  dashboard_recent_activity: 'dashboard_recent_activity',
  dashboard_saved_today: 'dashboard_saved_today',
  dashboard_snapshot: 'dashboard_snapshot',

  is_pro: 'is_pro',
  purchase_type: 'purchase_type',
  subscription_source: 'subscription_source',
  subscription_expires_at: 'subscription_expires_at',
  deployment_profile: 'deployment_profile',

  auto_sync: 'auto_sync',
  auto_sync_enabled: 'auto_sync_enabled',
  auto_sync_interval_minutes: 'auto_sync_interval_minutes',
  sync_interval_hours: 'sync_interval_hours',

  cached_pricing: 'cached_pricing',
} as const;

export const WATCHED_CACHE_KEYS = [
  CACHE_KEYS.session_token,
  CACHE_KEYS.account_state_revision,
  CACHE_KEYS.notion_connected,
  CACHE_KEYS.is_connecting,
  CACHE_KEYS.sync_in_progress,
  CACHE_KEYS.sync_enrichment_state,
  CACHE_KEYS.last_sync,
  CACHE_KEYS.last_sync_at,
  CACHE_KEYS.last_sync_summary,
  CACHE_KEYS.last_sync_count,
  CACHE_KEYS.last_sync_fingerprint,
  CACHE_KEYS.last_sync_hash,
  CACHE_KEYS.dashboard_last_sync,
  CACHE_KEYS.dashboard_recent_activity,
  CACHE_KEYS.dashboard_saved_today,
  CACHE_KEYS.dashboard_snapshot,
  CACHE_KEYS.is_pro,
  CACHE_KEYS.purchase_type,
  CACHE_KEYS.subscription_source,
  CACHE_KEYS.subscription_expires_at,
  CACHE_KEYS.deployment_profile,
  CACHE_KEYS.user_id,
  CACHE_KEYS.user_email,
  CACHE_KEYS.cached_pricing,
  CACHE_KEYS.auto_sync_enabled,
  CACHE_KEYS.auto_sync_interval_minutes,
] as const;

export type CacheKey = keyof typeof CACHE_KEYS;

// Tiny typed helpers around chrome.storage.local
export async function getCache<K extends keyof ChromeLocalCache>(
  keys: K | K[]
): Promise<Pick<ChromeLocalCache, K>> {
  const arr = Array.isArray(keys) ? (keys as string[]) : ([keys] as string[]);
  const res = await chrome.storage.local.get(arr);
  return res as Pick<ChromeLocalCache, K>;
}

export async function setCache(patch: Partial<ChromeLocalCache>): Promise<void> {
  await chrome.storage.local.set(patch as Record<string, unknown>);
}

export async function removeCache(keys: CacheKey | CacheKey[]): Promise<void> {
  const arr = Array.isArray(keys) ? (keys as string[]) : ([keys] as string[]);
  await chrome.storage.local.remove(arr);
}
