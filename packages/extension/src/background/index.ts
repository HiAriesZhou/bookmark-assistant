import './polyfill';
import type { LinkItem } from '@bookmark-assistant/types';
import {
  collectBookmarkSyncItems,
  createDefaultKnowledgeItemId,
  createSyncFingerprint,
  formatCurrentPageForSync,
  formatSavedLinkForSync,
  normalizeUrl,
  prepareLegacyLinkItemForSync,
  toSyncFingerprintItems,
  withBookmarkType,
} from '../core';
import { extractPageContentFromDocument } from '../core';
import { launchNotionOAuth, exchangeCodeForToken, debugOAuthSetup } from './oauth';
import { config, validateConfig, debugConfig } from './config';
import { serverAPI, APIError, SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS } from './server-api';
import { addMessageListener, Messages } from '../utils/message';
import { scheduleAutoSync, setupAutoSyncListener, restoreAutoSync } from './auto-sync';
import { reportError } from '../utils/error-reporter';
import { cleanupStorage } from '../utils/storage-cleanup';
import { getReadingListItems } from '../utils/reading-list';
import type { StoredSyncSummary } from '../dashboard/types';
import {
  DASHBOARD_SYNC_SUMMARY_KEY,
  classifyDashboardError,
  getDashboardSnapshot,
  inferSyncResult,
  recordDashboardEvent,
  recordDashboardSave,
} from './dashboard';
import { canSendCurrentPageToAi } from './ai-page-policy';
import {
  canCommitSyncFingerprint,
  createSyncExecutionGate,
  recoverInterruptedSyncState,
} from './sync-recovery';
import {
  consumePendingCurrentPageAi,
  createPendingCurrentPageAi,
  extractedPageMatchesPending,
  wasCurrentPageCreated,
} from './current-page-ai';
import { enqueueSyncEnrichment, setupSyncEnrichmentRecovery } from './sync-enrichment';
import {
  SAVE_TO_NOTION_CONTEXT_MENU_ID,
  syncDestinationContextMenu,
} from './destination-context-menu';

console.log('[BG] Service worker starting...');

// Cache for page descriptions (url -> { description: string, timestamp: number })
const pageDescriptionCache = new Map<string, { description: string; timestamp: number }>();
const DESCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DESCRIPTION_CACHE_STORAGE_KEY = 'page_description_cache';
const MAX_CACHE_SIZE = 1000; // Maximum number of cache entries before LRU eviction
// Bump only when payload shape, fingerprint inputs, or Notion write-back semantics change.
// This is a production sync migration gate, not a local debug switch.
const SYNC_SCHEMA_VERSION = 13;

function createSyncId(prefix: string) {
  return globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? (globalThis.crypto as any).randomUUID()
    : `${prefix}-${Date.now()}`;
}

type CurrentPageCaptureSource = 'current_page' | 'context_menu';
const CURRENT_PAGE_AI_REQUEST_TTL_MS = 5 * 60_000;

// Evict least recently used entries when cache exceeds max size
function evictLRUEntries() {
  if (pageDescriptionCache.size <= MAX_CACHE_SIZE) {
    return;
  }

  // Convert to array and sort by timestamp (oldest first)
  const entries = Array.from(pageDescriptionCache.entries())
    .map(([url, data]) => ({ url, ...data }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Remove oldest entries until we're under the limit
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  let removedCount = 0;
  for (const entry of toRemove) {
    pageDescriptionCache.delete(entry.url);
    removedCount++;
  }

  if (removedCount > 0) {
    console.log(
      `[DescriptionExtractor] Evicted ${removedCount} LRU entries (cache size: ${pageDescriptionCache.size}/${MAX_CACHE_SIZE})`
    );
  }
}

// Listen for page descriptions from content scripts
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'PAGE_DESCRIPTION') {
    const { url, description } = message.payload;
    const normalizedUrl = normalizeUrl(url);
    console.debug('[DescriptionExtractor] Received page description');

    // Update timestamp for LRU tracking
    pageDescriptionCache.set(normalizedUrl, {
      description,
      timestamp: Date.now(),
    });

    // Evict LRU entries if cache is too large
    evictLRUEntries();

    // Persist to storage
    persistDescriptionCache().catch((error) => {
      console.warn('[DescriptionExtractor] Failed to persist cache:', error);
    });
  }
});

// Persist cache to chrome.storage.local for persistence across service worker restarts
async function persistDescriptionCache() {
  try {
    const cacheObject: Record<string, { description: string; timestamp: number }> = {};
    pageDescriptionCache.forEach((value, key) => {
      cacheObject[key] = value;
    });
    await chrome.storage.local.set({ [DESCRIPTION_CACHE_STORAGE_KEY]: cacheObject });
    console.log(
      `[DescriptionExtractor] Persisted ${Object.keys(cacheObject).length} descriptions to storage`
    );
  } catch (error) {
    console.error('[DescriptionExtractor] Failed to persist cache to storage:', error);
  }
}

// Load cache from chrome.storage.local
async function loadDescriptionCacheFromStorage() {
  try {
    const result = await chrome.storage.local.get([DESCRIPTION_CACHE_STORAGE_KEY]);
    const cacheData = result[DESCRIPTION_CACHE_STORAGE_KEY];
    if (cacheData && typeof cacheData === 'object') {
      const now = Date.now();
      let loadedCount = 0;
      let expiredCount = 0;
      let normalizedCount = 0;

      for (const [url, data] of Object.entries(cacheData)) {
        if (
          data &&
          typeof data === 'object' &&
          'description' in data &&
          'timestamp' in data &&
          typeof (data as any).description === 'string' &&
          typeof (data as any).timestamp === 'number'
        ) {
          // Normalize URL when loading (handles migration of old cache entries)
          const normalizedUrl = normalizeUrl(url);
          const wasNormalized = normalizedUrl !== url;

          if (now - (data as any).timestamp <= DESCRIPTION_CACHE_TTL_MS) {
            // Use normalized URL as key
            pageDescriptionCache.set(normalizedUrl, {
              description: (data as any).description,
              timestamp: (data as any).timestamp,
            });
            loadedCount++;
            if (wasNormalized) {
              normalizedCount++;
            }
          } else {
            expiredCount++;
          }
        }
      }

      // Evict LRU entries if we loaded too many
      evictLRUEntries();

      console.log(
        `[DescriptionExtractor] Loaded ${loadedCount} descriptions from storage (${expiredCount} expired, ${normalizedCount} normalized)`
      );
    }
  } catch (error) {
    console.error('[DescriptionExtractor] Failed to load cache from storage:', error);
  }
}

// Clean up expired cache entries periodically
setInterval(
  async () => {
    const now = Date.now();
    let deletedCount = 0;
    for (const [url, data] of pageDescriptionCache.entries()) {
      if (now - data.timestamp > DESCRIPTION_CACHE_TTL_MS) {
        pageDescriptionCache.delete(url);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`[DescriptionExtractor] Cleaned up ${deletedCount} expired descriptions`);
      await persistDescriptionCache();
    }
  },
  60 * 60 * 1000
); // Check every hour

function getCachedDescription(url: string): string {
  // Normalize URL before lookup to ensure cache hits
  const normalizedUrl = normalizeUrl(url);
  const cached = pageDescriptionCache.get(normalizedUrl);

  if (!cached) {
    console.debug('[DescriptionExtractor] Cache miss');
    return '';
  }

  // Check if expired
  if (Date.now() - cached.timestamp > DESCRIPTION_CACHE_TTL_MS) {
    console.debug('[DescriptionExtractor] Cache entry expired');
    pageDescriptionCache.delete(normalizedUrl);
    return '';
  }

  // Update timestamp for LRU tracking (mark as recently used)
  cached.timestamp = Date.now();

  console.debug('[DescriptionExtractor] Cache hit');
  return cached.description;
}

// Load cache on service worker startup
loadDescriptionCacheFromStorage();

// import './test-oauth-flow'; // Removed in production build

// A new MV3 worker cannot resume an in-flight request from an earlier worker.
async function resetStaleSyncState() {
  try {
    const recovered = await recoverInterruptedSyncState(chrome.storage.local);
    if (recovered) {
      console.warn('[Background] Recovered interrupted sync state');
      await recordDashboardEvent({
        kind: 'sync_completed',
        ...(recovered.trigger ? { trigger: recovered.trigger } : {}),
        result: 'failed',
        counts: { total: 0, success: 0, failed: 1, skipped: 0 },
        errorCategory: 'network',
        action: 'retry',
      });
    }
  } catch (error) {
    console.warn('[Background] Failed to reset stale sync state:', error);
  }
}

debugConfig();
debugOAuthSetup();

// Reset stale state before any manual, automatic, or catch-up sync can begin.
const backgroundInitialization = resetStaleSyncState()
  .then(async () => {
    // Clean up storage (remove redundant fields, fix NaN issues, etc.)
    await cleanupStorage();

    const configValidation = validateConfig();
    if (!configValidation.isValid) {
      console.error('❌ Configuration errors:', configValidation.errors);
    }
    if (configValidation.warnings.length > 0) {
      console.warn('⚠️ Configuration warnings:', configValidation.warnings);
    }
  })
  .catch((error) => {
    console.warn('[Background] Initialization failed; continuing with sync available:', error);
  });

type BookmarkSyncResult = {
  success: boolean;
  error?: string;
  noChanges?: boolean;
};

const runSyncOnce = createSyncExecutionGate<BookmarkSyncResult>(backgroundInitialization);

// Extract sync logic into a reusable function
async function performBookmarkSync(
  trigger: 'manual' | 'auto' = 'manual'
): Promise<BookmarkSyncResult> {
  return runSyncOnce(() => performBookmarkSyncAfterInitialization(trigger));
}

async function performBookmarkSyncAfterInitialization(
  trigger: 'manual' | 'auto'
): Promise<BookmarkSyncResult> {
  const setState = async (patch: Record<string, any>) => {
    try {
      await chrome.storage.local.set(patch);
    } catch (e) {
      console.warn('Failed to update sync state:', patch, e);
    }
  };

  // Declare variables outside try block so they're accessible in catch
  let formatted: LinkItem[] = [];
  let currentHash: string | undefined;
  let latestSummary: StoredSyncSummary | undefined;

  try {
    const startedAt = Date.now();
    const MIN_PROGRESS_MS = 1200; // keep UI spinner visible to avoid flicker / rapid re-clicks
    const bookmarkTree = await chrome.bookmarks.getTree();
    const flat = bookmarkTree[0]?.children || [];

    await setState({
      sync_in_progress: true,
      sync_started_at: startedAt,
      sync_trigger: trigger,
      last_sync_error: null,
    });
    await recordDashboardEvent({ kind: 'sync_started', trigger });

    console.log('[Sync] Starting to flatten bookmarks...');
    const collectedBookmarks = await collectBookmarkSyncItems(flat, {
      getDescription: (url) => {
        const description = getCachedDescription(url);
        console.debug(`[Sync] Description cache ${description ? 'hit' : 'miss'}`);
        return description;
      },
    });
    formatted = collectedBookmarks.items;
    const minimalForHash = [...collectedBookmarks.fingerprintItems];
    console.log(`[Sync] Flattened ${formatted.length} bookmarks`);
    console.log(`[Sync] Cache size: ${pageDescriptionCache.size} URLs with descriptions`);

    // Collect reading list items
    let readingListItems: LinkItem[] = [];
    try {
      readingListItems = await getReadingListItems();
      if (readingListItems.length > 0) {
        console.log(`[Sync] Found ${readingListItems.length} reading list items`);
      }
    } catch (err) {
      console.warn('[Sync] Failed to get reading list items:', err);
    }

    // Combine bookmarks and reading list items for unified sync
    const bookmarksWithType = withBookmarkType(formatted);
    const readingListUrls = new Set(readingListItems.map((item) => item.url));
    const bookmarksForSync = bookmarksWithType.filter((item) => !readingListUrls.has(item.url));
    const legacyBookmarksForSync = bookmarksForSync.map((bookmark) => {
      const prepared = prepareLegacyLinkItemForSync(bookmark, {
        now: () => new Date(),
        createId: createDefaultKnowledgeItemId,
        normalizeUrl,
      });
      if (!prepared.success) {
        throw new Error('Chrome bookmark capture cannot be synced');
      }
      return prepared.item;
    });
    const legacyReadingListItems = readingListItems.map((readingListItem) => {
      const prepared = prepareLegacyLinkItemForSync(readingListItem, {
        now: () => new Date(),
        createId: createDefaultKnowledgeItemId,
        normalizeUrl,
      });
      if (!prepared.success) {
        throw new Error('Reading list capture cannot be synced');
      }
      return prepared.item;
    });
    const allItems = [...legacyBookmarksForSync, ...legacyReadingListItems];
    console.log(
      `[Sync] Total items to sync: ${allItems.length} (${bookmarksForSync.length} bookmarks, ${readingListItems.length} reading list)`
    );

    minimalForHash.push(...toSyncFingerprintItems(readingListItems, 'Reading List'));

    const fp = await createSyncFingerprint(minimalForHash);
    const {
      last_sync_fingerprint: prevFp,
      last_sync_count: prevCount,
      last_sync_payload_version: prevPayloadVersion,
    } = await chrome.storage.local.get([
      'last_sync_fingerprint',
      'last_sync_count',
      'last_sync_payload_version',
    ]);
    const currentCount = allItems.length;
    currentHash = fp; // Use existing declaration
    const previousHash = prevFp;

    // Hash comparison: compare total count and hash
    // This prevents unnecessary sync when bookmarks haven't changed
    const hasNoChanges =
      typeof prevCount === 'number' &&
      typeof previousHash === 'string' &&
      prevPayloadVersion === SYNC_SCHEMA_VERSION &&
      prevCount === currentCount &&
      previousHash === currentHash;

    if (hasNoChanges) {
      const completedAt = new Date().toISOString();
      latestSummary = {
        result: 'no_changes',
        completedAt,
        total: currentCount,
        success: 0,
        failed: 0,
        skipped: currentCount,
      };
      // No changes — keep last successful sync timestamp; just notify summary
      await setState({
        last_sync: completedAt, // Update timestamp even for no changes
        last_sync_summary: 'no_changes',
        last_sync_count: currentCount,
        last_sync_payload_version: SYNC_SCHEMA_VERSION,
        [DASHBOARD_SYNC_SUMMARY_KEY]: latestSummary,
      });
      await recordDashboardEvent({
        kind: 'sync_completed',
        trigger,
        result: 'no_changes',
        counts: { total: currentCount, success: 0, failed: 0, skipped: currentCount },
      });
      // Ensure minimal progress duration
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROGRESS_MS) {
        await new Promise((r) => setTimeout(r, MIN_PROGRESS_MS - elapsed));
      }
      await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
      return { success: true, noChanges: true } as const;
    }

    console.log(
      `[Sync] Preparing to sync ${allItems.length} items (${bookmarksForSync.length} bookmarks, ${readingListItems.length} reading list) to server`
    );

    console.log('[Sync] Sending bookmarks to server...');
    const syncResponse = await serverAPI.syncBookmarks(allItems, { deferEnhancements: true });
    console.log('[Sync] Server sync summary:', syncResponse.summary);
    if (syncResponse.summary?.readingListTotal !== undefined) {
      console.log(
        `[Sync] Reading list server result: total=${syncResponse.summary.readingListTotal}, success=${syncResponse.summary.readingListSuccess ?? 0}, failed=${syncResponse.summary.readingListFailed ?? 0}, skipped=${syncResponse.summary.readingListSkippedExisting ?? 0}`
      );
    }
    const completedAt = new Date().toISOString();
    const failedCount = syncResponse.summary?.failed || 0;
    const deferredCount = syncResponse.summary?.deferred || syncResponse.partialSync?.skipped || 0;
    const successCount = syncResponse.summary?.success || 0;
    const skippedCount = syncResponse.summary?.skippedExisting || 0;
    latestSummary = {
      result: failedCount > 0 || deferredCount > 0 ? 'partial_failure' : 'success',
      completedAt,
      total: syncResponse.summary?.total || currentCount,
      success: successCount,
      failed: failedCount + deferredCount,
      skipped: skippedCount,
    };
    if (
      !canCommitSyncFingerprint({
        failed: failedCount,
        deferred: deferredCount,
        partialSkipped: syncResponse.partialSync?.skipped,
      })
    ) {
      const reason =
        deferredCount > 0
          ? `${deferredCount} item(s) were deferred before the server deadline`
          : `${failedCount} failed item(s)`;
      throw new Error(`Server sync completed with ${reason}. Please try again.`);
    }
    console.log('[Sync] Server sync completed successfully');

    await setState({
      last_sync: completedAt,
      last_sync_summary: null,
      last_sync_count: currentCount,
      last_sync_fingerprint: fp,
      last_sync_payload_version: SYNC_SCHEMA_VERSION,
      [DASHBOARD_SYNC_SUMMARY_KEY]: latestSummary,
    });
    await recordDashboardEvent({
      kind: 'sync_completed',
      trigger,
      result: 'success',
      counts: {
        total: latestSummary.total,
        success: latestSummary.success,
        failed: 0,
        skipped: latestSummary.skipped,
      },
    });

    if (syncResponse.enrichment?.items.length) {
      try {
        await enqueueSyncEnrichment(syncResponse.enrichment);
      } catch (error) {
        // The base sync and fingerprint are already durable. Surface enrichment
        // separately without turning a successful Notion sync into a failure.
        console.warn('[Sync Enrichment] Failed to persist deferred work:', error);
      }
    }

    // Ensure minimal progress duration before clearing flag
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_PROGRESS_MS) {
      await new Promise((r) => setTimeout(r, MIN_PROGRESS_MS - elapsed));
    }
    await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
    return { success: true } as const;
  } catch (err) {
    console.error('❌ Server-side bookmark sync failed:', err);

    // Report error to server for monitoring
    const error = err instanceof Error ? err : new Error(String(err));
    await reportError(error, {
      operation: 'sync',
      bookmarkCount: formatted?.length || 0,
      syncHash: currentHash,
    });

    const summary: Record<string, any> = {};
    if (err instanceof APIError) {
      if (err.status === 429) {
        const ra = Number.isFinite(err.retryAfterSeconds) ? (err.retryAfterSeconds as number) : 0;
        // Heuristic: long retry-after (>= 1h) implies daily limit; short is cooldown
        summary.last_sync_summary = ra >= 3600 ? 'limit' : 'cooldown';
        if (ra > 0) {
          summary.sync_cooldown_until = Date.now() + ra * 1000;
        }
      } else if (err.status === 409) {
        summary.last_sync_summary = 'in_progress';
      } else if (err.status === 403) {
        summary.last_sync_summary = 'limit';
      }
    }
    const completedAt = new Date().toISOString();
    const result = inferSyncResult(latestSummary, err);
    const failedSummary: StoredSyncSummary = latestSummary
      ? { ...latestSummary, result, completedAt }
      : { result, completedAt, total: formatted.length, success: 0, failed: 1, skipped: 0 };
    await setState({
      last_sync_error: err instanceof Error ? err.message : String(err),
      [DASHBOARD_SYNC_SUMMARY_KEY]: failedSummary,
      ...summary,
    });
    await recordDashboardEvent({
      kind: 'sync_completed',
      trigger,
      result,
      counts: {
        total: failedSummary.total,
        success: failedSummary.success,
        failed: failedSummary.failed,
        skipped: failedSummary.skipped,
      },
      errorCategory: classifyDashboardError(err),
      action: result === 'limited' ? undefined : 'retry',
    });
    try {
      await new Promise((r) => setTimeout(r, 600));
    } catch {}
    await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
    return { success: false, error: String(err) } as const;
  }
}

// Save the base capture first. AI is a separate, explicitly bounded message so
// the popup can acknowledge a successful Notion write immediately.
async function saveCurrentPage(
  source: CurrentPageCaptureSource = 'current_page'
): Promise<{ success: boolean; error?: string; aiStatus?: string; aiRequestId?: string }> {
  try {
    // Check if user is connected first
    const { session_token } = await chrome.storage.local.get('session_token');
    if (!session_token) {
      return { success: false, error: 'Not connected' };
    }

    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.title) {
      return { success: false, error: 'No active tab found' };
    }

    // Skip chrome:// and other internal URLs
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
      return { success: false, error: 'Cannot save internal page' };
    }

    const bookmark =
      source === 'current_page'
        ? formatCurrentPageForSync(
            { title: tab.title, url: tab.url, description: '' },
            { createSyncId: () => createSyncId('quick-save'), defaultPath: 'Quick Saves' }
          )
        : formatSavedLinkForSync(
            { title: tab.title, url: tab.url, description: '', path: 'Quick Saves' },
            { createSyncId: () => createSyncId('quick-save'), source: 'context_menu' }
          );

    const legacyMapping = prepareLegacyLinkItemForSync(bookmark, {
      now: () => new Date(),
      createId: createDefaultKnowledgeItemId,
      normalizeUrl,
    });
    if (!legacyMapping.success) {
      throw new Error('Current page capture cannot be synced');
    }

    const syncResponse = await serverAPI.syncBookmarks([legacyMapping.item], {
      aiBatchEligible: false,
      requestTimeoutMs: SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS,
    });

    await recordDashboardSave(source).catch((dashboardError) => {
      console.warn(
        '[saveCurrentPage] Saved, but dashboard activity was not recorded:',
        dashboardError
      );
    });

    if (
      source !== 'current_page' ||
      tab.id === undefined ||
      !legacyMapping.item.syncId ||
      !wasCurrentPageCreated(syncResponse.results || [], legacyMapping.item.syncId)
    ) {
      return { success: true, aiStatus: 'not_started' };
    }

    try {
      const aiRequestId = await createPendingCurrentPageAi(
        {
          tabId: tab.id,
          url: tab.url,
          syncId: legacyMapping.item.syncId,
          knowledgeItemId: createDefaultKnowledgeItemId({
            source: 'current_page',
            canonicalUrl: normalizeUrl(tab.url),
          }),
        },
        {
          requestId: createSyncId('current-page-ai'),
          expiresAt: Date.now() + CURRENT_PAGE_AI_REQUEST_TTL_MS,
        }
      );
      return { success: true, aiStatus: 'pending', aiRequestId };
    } catch (aiHandoffError) {
      console.warn(
        '[saveCurrentPage] Base save completed, but AI handoff was not stored:',
        aiHandoffError
      );
      return { success: true, aiStatus: 'not_started' };
    }
  } catch (error) {
    console.error('[saveCurrentPage] Failed:', error);
    await recordDashboardEvent({
      kind: 'error',
      source,
      result: 'failed',
      errorCategory: classifyDashboardError(error),
      action: 'retry',
    });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function generateCurrentPageAi(
  aiRequestId: string
): Promise<{ success: boolean; error?: string; aiStatus?: string }> {
  const pending = await consumePendingCurrentPageAi(aiRequestId);
  if (!pending || pending.expiresAt <= Date.now()) {
    return { success: true, aiStatus: 'not_started' };
  }

  try {
    // Privacy and entitlement checks happen before page content is read.
    const [settingsResult, credentialResult] = await Promise.all([
      serverAPI.getAiSettings(),
      serverAPI.getAiCredential(),
    ]);
    const settings = settingsResult?.settings;
    const credential = credentialResult?.credential;
    if (!canSendCurrentPageToAi(pending.url, settings) || credential?.status !== 'verified') {
      return { success: true, aiStatus: 'not_started' };
    }

    const extracted = await chrome.scripting.executeScript({
      target: { tabId: pending.tabId },
      func: extractPageContentFromDocument,
    });
    const page = extracted[0]?.result;
    if (!extractedPageMatchesPending(pending, page)) {
      return { success: true, aiStatus: 'skipped_navigation_changed' };
    }
    const body = page.text || '';
    if (!body) return { success: true, aiStatus: 'skipped_insufficient_content' };

    const result = await serverAPI.generateCurrentPage({
      knowledgeItemId: pending.knowledgeItemId,
      syncId: pending.syncId,
      url: pending.url,
      body,
    });
    return { success: true, aiStatus: result.status };
  } catch (error) {
    console.warn('[generateCurrentPageAi] AI processing did not start:', error);
    return { success: true, aiStatus: 'not_started' };
  }
}

// Setup auto-sync alarm listener
setupAutoSyncListener(async () => {
  await performBookmarkSync('auto');
});

// Restore auto-sync alarm on service worker startup
restoreAutoSync(() => performBookmarkSync('auto'));
setupSyncEnrichmentRecovery();

// Register context menu click listener before its connection-derived state is applied.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[DEBUG] Context menu clicked:', info.menuItemId);
  if (info.menuItemId === SAVE_TO_NOTION_CONTEXT_MENU_ID) {
    console.log('[DEBUG] saveToNotion handler started');
    // Check if user is connected first
    const { session_token } = await chrome.storage.local.get('session_token');
    console.log('[DEBUG] session_token:', session_token ? 'exists' : 'missing');
    if (!session_token) {
      console.log('[Context Menu] Not connected to Notion');
      return;
    }

    // Context Menu is a distinct capture source and remains URL-only. It must
    // not silently enter the current-page or batch-AI flows.
    if (!info.linkUrl) {
      await saveCurrentPage('context_menu');
      return;
    }

    // Link saves intentionally remain URL-only and do not claim to summarize the
    // surrounding page.
    const url = info.linkUrl;
    const title = (info as any).linkText || tab?.title || 'Untitled';

    if (!url) {
      console.log('[DEBUG] No URL found');
      return;
    }

    // Skip internal URLs
    if (url.startsWith('chrome://') || url.startsWith('about:')) {
      console.log('[Context Menu] Skipping internal URL');
      return;
    }

    console.log('[Context Menu] Saving page');
    try {
      const bookmark = formatSavedLinkForSync(
        {
          title,
          url,
          description: '',
          path: 'Quick Saves',
        },
        {
          createSyncId: () => createSyncId('quick-save'),
          source: 'context_menu',
        }
      );

      const legacyMapping = prepareLegacyLinkItemForSync(bookmark, {
        now: () => new Date(),
        createId: createDefaultKnowledgeItemId,
        normalizeUrl,
      });
      if (!legacyMapping.success) {
        throw new Error('Context menu capture cannot be synced');
      }

      await serverAPI.syncBookmarks([legacyMapping.item], {
        aiBatchEligible: false,
        requestTimeoutMs: SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS,
      });
      await recordDashboardSave('context_menu');
      console.log('[Context Menu] Page saved successfully');
    } catch (error) {
      console.error('[Context Menu] Save failed:', error);
      await recordDashboardEvent({
        kind: 'error',
        source: 'context_menu',
        result: 'failed',
        errorCategory: classifyDashboardError(error),
        action: 'retry',
      });
    }
  }
});

// Keep destination-only actions aligned with the active connection.
void syncDestinationContextMenu();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.session_token) return;
  void syncDestinationContextMenu();
});

addMessageListener({
  [Messages.NOTION_OAUTH]: async () => {
    try {
      // Set connecting state at the start
      await chrome.storage.local.set({ is_connecting: true });
      const code = await launchNotionOAuth();
      const result = await exchangeCodeForToken(code);
      // Clear connecting state after OAuth completes
      await chrome.storage.local.set({ is_connecting: false });

      // Refresh entitlements after successful OAuth
      // This ensures isPro status is updated after authentication
      try {
        // The OAuth exchange changes the session token, which invalidates the
        // background profile cache. Other post-connect readers can safely join
        // this fresh request instead of starting their own fetch.
        const { user, isPro } = await serverAPI.getUserProfile();
        await chrome.storage.local.set({
          is_pro: isPro,
          purchase_type: user.purchaseType,
          subscription_source: user.subscriptionSource,
          subscription_expires_at: user.expiresAt,
          deployment_profile: {
            deploymentMode: user.deploymentMode || 'hosted',
            commerceEnabled: user.commerceEnabled ?? true,
            capabilities: user.capabilities || { autoSync: isPro, batchAi: isPro },
            apiOrigin: new URL(config.notion.serverUrl).origin,
          },
          entitlements_cached_at: Date.now(),
        });
      } catch (profileError) {
        console.warn('⚠️ Failed to refresh entitlements after OAuth:', profileError);
        // Don't fail the OAuth flow if profile refresh fails
      }

      await recordDashboardEvent({ kind: 'connection_checked', result: 'success' });

      return result;
    } catch (error) {
      // Clear connecting state on error
      await chrome.storage.local.set({ is_connecting: false });

      // Report OAuth errors to server
      const err = error instanceof Error ? error : new Error(String(error));
      await reportError(err, {
        operation: 'oauth',
        stage: 'exchange_token',
      });

      throw error;
    }
  },
  [Messages.SYNC_ALL_BOOKMARKS]: async () => {
    return await performBookmarkSync('manual');
  },
  [Messages.SAVE_CURRENT_PAGE]: async () => {
    console.log('[BG] SAVE_CURRENT_PAGE message received');
    return await saveCurrentPage();
  },
  [Messages.GENERATE_CURRENT_PAGE_AI]: async (req) => {
    console.log('[BG] GENERATE_CURRENT_PAGE_AI message received');
    return await generateCurrentPageAi(req.aiRequestId);
  },
  [Messages.GET_USER_PROFILE]: async (req) => {
    try {
      const { user, isPro } = await serverAPI.getUserProfile({
        forceRefresh: req.forceRefresh === true,
      });
      return { success: true, profile: user, isPro } as const;
    } catch (err) {
      console.error('❌ Failed to get user profile:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.GET_DASHBOARD_STATE]: async (req) => {
    try {
      const dashboard = await getDashboardSnapshot(req.refreshConnection === true);
      return { success: true, dashboard } as const;
    } catch (err) {
      console.error('❌ Failed to build dashboard state:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.GET_PRICING]: async () => {
    try {
      const { pricing } = await serverAPI.getPricing();
      return { success: true, pricing } as const;
    } catch (err) {
      console.error('❌ Failed to get pricing:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.GET_PORTAL_LINK]: async () => {
    try {
      const res = await serverAPI.getPortalLink();
      return { success: res.success, url: res.url, error: res.error } as const;
    } catch (err) {
      console.error('❌ Failed to get portal link:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.CANCEL_SUBSCRIPTION]: async () => {
    try {
      const res = await serverAPI.cancelSubscription();
      return { success: res.success, error: res.error } as const;
    } catch (err) {
      console.error('❌ Failed to cancel subscription:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.GET_SUBSCRIPTION_INFO]: async () => {
    try {
      const res = await serverAPI.getSubscriptionInfo();
      return {
        success: res.success,
        nextBillingDate: res.nextBillingDate,
        status: res.status,
        error: res.error,
      } as const;
    } catch (err) {
      console.error('❌ Failed to get subscription info:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.LOGOUT]: async () => {
    try {
      await serverAPI.logout();
      return { success: true } as const;
    } catch (err) {
      console.error('❌ Logout failed:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.RESTORE_PURCHASE]: async (req: { email: string }) => {
    try {
      const res = await serverAPI.restorePurchase(req.email);
      return { success: res.success, message: res.message } as const;
    } catch (err) {
      console.error('❌ Restore purchase failed:', err);
      return { success: false, error: String(err) } as const;
    }
  },
  [Messages.SCHEDULE_AUTO_SYNC]: async (req: { enabled: boolean; intervalHours: number }) => {
    try {
      await scheduleAutoSync(req.enabled, req.intervalHours);
      return { success: true } as const;
    } catch (err) {
      console.error('❌ Failed to schedule auto-sync:', err);
      return { success: false, error: String(err) } as const;
    }
  },
});

// Open the options page when the user clicks the extension icon
try {
  chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
  });
} catch {
  // Some environments may not support action.onClicked in mocks; ignore
}

// Global error handlers to catch unhandled errors
if (typeof self !== 'undefined') {
  self.addEventListener('error', (event) => {
    console.error('[Global Error]', event.error);
    reportError(event.error || new Error(event.message), {
      type: 'unhandled',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    }).catch(() => {
      // Fail silently if error reporting fails
    });
  });

  self.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled Rejection]', event.reason);
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    reportError(error, {
      type: 'unhandled_promise',
    }).catch(() => {
      // Fail silently if error reporting fails
    });
  });
}

console.log('[BG] Service worker initialization complete');
