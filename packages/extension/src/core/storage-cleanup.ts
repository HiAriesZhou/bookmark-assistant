export interface StorageCleanupPlan {
  removeKeys: string[];
  updateValues: Record<string, unknown>;
}

/** Set for a user who connected Notion through the retired service and must add a token. */
export const NOTION_RECONNECT_NOTICE_KEY = 'notion_reconnect_notice';

// Keys written by earlier versions. Removed by exact name only, never by prefix.
const RETIRED_KEYS = [
  // Account, plan and server session.
  'session_token',
  'user_id',
  'user_email',
  'notion_connected',
  'is_pro',
  'purchase_type',
  'subscription_source',
  'subscription_expires_at',
  'entitlements_cached_at',
  'deployment_profile',
  'account_created_notice',
  'has_google_sign_in',
  'account_state_revision',
  'cached_pricing',
  'is_refreshing_entitlements',
  // Server sync and AI enrichment.
  'oauth_template_database_id',
  'is_connecting',
  'sync_enrichment_job',
  'sync_enrichment_state',
  'last_bulk_sync',
  'last_sync_results',
  'error_reports',
  // Older caches and flags.
  'page_description_cache',
  'last_sync_hash',
  'hasTriedInitialLoad',
  'last_sync_partial_info',
];

export function planStorageCleanup(storage: Record<string, unknown>): StorageCleanupPlan {
  const removeKeys = RETIRED_KEYS.filter((key) => key in storage);
  const connectedThroughService = storage.notion_connected === true && !storage.notion_token;
  return {
    removeKeys,
    updateValues: connectedThroughService ? { [NOTION_RECONNECT_NOTICE_KEY]: true } : {},
  };
}
