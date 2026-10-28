import './polyfill';
import type { LinkItem } from '@bookmark-assistant/types';
import {
  collectBookmarkSyncItems,
  createDefaultKnowledgeItemId,
  createSyncFingerprint,
  formatCurrentPageForSync,
  formatSavedLinkForSync,
  isWebPageUrl,
  normalizeUrl,
  prepareLegacyLinkItemForSync,
  toSyncFingerprintItems,
  withBookmarkType,
} from '../core';
import {
  NOTION_DATABASE_KEY,
  NOTION_TOKEN_KEY,
  StaleDestinationStateError,
  assertDestinationContextCurrent,
  clearNotionConnection,
  commitNotionConnection,
  isDestinationContextCurrent,
  isStaleDestinationStateError,
  readDestinationContext,
  readNotionConnection,
  withCurrentDestination,
  type DestinationContext,
} from '../utils/destination-state';
import { notionApi } from '../destinations/notion/notion-api';
import { syncLinksToNotion } from '../destinations/notion/sync';
import { readTabDescription } from './page-description';
import { recordConnectionFailure } from './connection-health';
import { isNotionId } from '../destinations/notion/ids';
import {
  OrganizeError,
  deleteOrganizeKey,
  isOrganizeSenderAllowed,
  readOrganizeKeySummary,
  runOrganizeBatch,
  saveOrganizeKey,
  type OrganizeErrorCode,
} from './library-organize';
import { addMessageListener, Messages, type MessageResponse } from '../utils/message';
import { scheduleAutoSync, setupAutoSyncListener, restoreAutoSync } from './auto-sync';
import { cleanupStorage } from '../utils/storage-cleanup';
import { getReadingListItems } from '../utils/reading-list';
import type { StoredSyncSummary } from '../dashboard/types';
import {
  DASHBOARD_SYNC_SUMMARY_KEY,
  classifyDashboardError,
  getDashboardSnapshot,
  inferSyncResult,
  recordDestinationActivity,
  recordDashboardEvent,
  recordDashboardSave,
} from './dashboard';
import {
  canCommitSyncFingerprint,
  createSyncExecutionGate,
  recoverInterruptedSyncState,
} from './sync-recovery';
import {
  SAVE_TO_NOTION_CONTEXT_MENU_ID,
  syncDestinationContextMenu,
} from './destination-context-menu';

// Bump only when payload shape, fingerprint inputs, or Notion write-back semantics change.
// This is a production sync migration gate, not a local debug switch.
const SYNC_SCHEMA_VERSION = 13;
const DEFAULT_DATABASE_TITLE = 'Bookmark Assistant';

function createSyncId(prefix: string) {
  return globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `${prefix}-${Date.now()}`;
}

type CurrentPageCaptureSource = 'current_page' | 'context_menu';

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

// Reset stale state before any manual, automatic, or catch-up sync can begin.
const backgroundInitialization = resetStaleSyncState()
  .then(() => cleanupStorage())
  .catch((error) => {
    console.warn('[Background] Initialization failed; continuing with sync available:', error);
  });

type BookmarkSyncResult = {
  success: boolean;
  error?: string;
  noChanges?: boolean;
};

const runSyncOnce = createSyncExecutionGate<BookmarkSyncResult>(backgroundInitialization);

// Writes use the connection captured when the work started and stop once it changes.
function notionConnectionFrom(context: DestinationContext) {
  if (!context.token || !context.databaseId) throw new Error('Notion is not connected');
  return { token: context.token, databaseId: context.databaseId };
}

const writeOptionsFor = (context: DestinationContext) => ({
  assertCurrent: () => assertDestinationContextCurrent(context),
});

async function performBookmarkSync(
  trigger: 'manual' | 'auto' = 'manual',
  expectedContext?: DestinationContext
): Promise<BookmarkSyncResult> {
  const context = expectedContext ?? (await readDestinationContext());
  await assertDestinationContextCurrent(context);
  // Nothing to sync to: answer without recording a failed sync.
  if (!context.token || !context.databaseId) return { success: false, error: 'Not connected' };
  return runSyncOnce(() => performBookmarkSyncAfterInitialization(trigger, context), context);
}

async function performBookmarkSyncAfterInitialization(
  trigger: 'manual' | 'auto',
  context: DestinationContext
): Promise<BookmarkSyncResult> {
  const setState = async (patch: Record<string, any>) => {
    try {
      await withCurrentDestination(context, () => chrome.storage.local.set(patch));
    } catch (e) {
      if (isStaleDestinationStateError(e)) throw e;
      console.warn('Failed to update sync state:', patch, e);
    }
  };

  const recordEvent = (event: Parameters<typeof recordDashboardEvent>[0]) =>
    withCurrentDestination(context, () => recordDashboardEvent(event));

  let formatted: LinkItem[] = [];
  let latestSummary: StoredSyncSummary | undefined;

  try {
    await assertDestinationContextCurrent(context);
    const connection = notionConnectionFrom(context);
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
    await recordEvent({ kind: 'sync_started', trigger });

    const collectedBookmarks = await collectBookmarkSyncItems(flat);
    formatted = collectedBookmarks.items;
    const minimalForHash = [...collectedBookmarks.fingerprintItems];

    let readingListItems: LinkItem[] = [];
    try {
      readingListItems = await getReadingListItems();
    } catch (err) {
      console.warn('[Sync] Failed to get reading list items:', err);
    }

    // Combine bookmarks and reading list items for unified sync
    const bookmarksWithType = withBookmarkType(formatted);
    const readingListUrls = new Set(readingListItems.map((item) => item.url));
    const bookmarksForSync = bookmarksWithType.filter((item) => !readingListUrls.has(item.url));
    const prepare = (item: LinkItem, invalidMessage: string) => {
      const prepared = prepareLegacyLinkItemForSync(item, {
        now: () => new Date(),
        createId: createDefaultKnowledgeItemId,
        normalizeUrl,
      });
      if (!prepared.success) throw new Error(invalidMessage);
      return prepared.item;
    };
    const allItems = [
      ...bookmarksForSync.map((item) => prepare(item, 'Chrome bookmark capture cannot be synced')),
      ...readingListItems.map((item) => prepare(item, 'Reading list capture cannot be synced')),
    ];

    minimalForHash.push(...toSyncFingerprintItems(readingListItems, 'Reading List'));

    const fingerprint = await createSyncFingerprint(minimalForHash);
    const {
      last_sync_fingerprint: previousFingerprint,
      last_sync_count: previousCount,
      last_sync_payload_version: previousPayloadVersion,
    } = await chrome.storage.local.get([
      'last_sync_fingerprint',
      'last_sync_count',
      'last_sync_payload_version',
    ]);
    const currentCount = allItems.length;

    // Skip the Notion round trip when nothing changed since the last full sync.
    const hasNoChanges =
      typeof previousCount === 'number' &&
      typeof previousFingerprint === 'string' &&
      previousPayloadVersion === SYNC_SCHEMA_VERSION &&
      previousCount === currentCount &&
      previousFingerprint === fingerprint;

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
      await setState({
        last_sync: completedAt,
        last_sync_summary: 'no_changes',
        last_sync_count: currentCount,
        last_sync_payload_version: SYNC_SCHEMA_VERSION,
        [DASHBOARD_SYNC_SUMMARY_KEY]: latestSummary,
      });
      await recordEvent({
        kind: 'sync_completed',
        trigger,
        result: 'no_changes',
        counts: { total: currentCount, success: 0, failed: 0, skipped: currentCount },
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROGRESS_MS) {
        await new Promise((r) => setTimeout(r, MIN_PROGRESS_MS - elapsed));
      }
      await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
      return { success: true, noChanges: true } as const;
    }

    await assertDestinationContextCurrent(context);
    const syncResponse = await syncLinksToNotion(
      notionApi,
      connection,
      allItems,
      writeOptionsFor(context)
    );
    const completedAt = new Date().toISOString();
    const failedCount = syncResponse.summary.failed || 0;
    latestSummary = {
      result: failedCount > 0 ? 'partial_failure' : 'success',
      completedAt,
      total: syncResponse.summary.total || currentCount,
      success: syncResponse.summary.success || 0,
      failed: failedCount,
      skipped: syncResponse.summary.skippedExisting || 0,
    };
    if (!canCommitSyncFingerprint({ failed: failedCount })) {
      throw new Error(
        `Notion sync completed with ${failedCount} failed item(s). Please try again.`
      );
    }

    await setState({
      last_sync: completedAt,
      last_sync_summary: null,
      last_sync_count: currentCount,
      last_sync_fingerprint: fingerprint,
      last_sync_payload_version: SYNC_SCHEMA_VERSION,
      [DASHBOARD_SYNC_SUMMARY_KEY]: latestSummary,
    });
    await recordEvent({
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

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_PROGRESS_MS) {
      await new Promise((r) => setTimeout(r, MIN_PROGRESS_MS - elapsed));
    }
    await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
    return { success: true } as const;
  } catch (err) {
    if (isStaleDestinationStateError(err) || !(await isDestinationContextCurrent(context)))
      return { success: false, error: 'The Notion connection changed' };
    console.error('❌ Notion bookmark sync failed:', err);

    const rateLimited = (err as { status?: unknown } | null)?.status === 429;
    const connectionAction = await recordConnectionFailure(context, err).catch(
      () => 'retry' as const
    );
    const completedAt = new Date().toISOString();
    const result = inferSyncResult(latestSummary, err);
    const failedSummary: StoredSyncSummary = latestSummary
      ? { ...latestSummary, result, completedAt }
      : { result, completedAt, total: formatted.length, success: 0, failed: 1, skipped: 0 };
    await setState({
      last_sync_error: err instanceof Error ? err.message : String(err),
      [DASHBOARD_SYNC_SUMMARY_KEY]: failedSummary,
      ...(rateLimited ? { last_sync_summary: 'cooldown' } : {}),
    });
    await recordEvent({
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
      action: result === 'limited' ? undefined : connectionAction,
    });
    await new Promise((r) => setTimeout(r, 600));
    await setState({ sync_in_progress: false, sync_started_at: null, sync_trigger: null });
    return { success: false, error: err instanceof Error ? err.message : String(err) } as const;
  }
}

// Current page and context menu captures share this single-row save.
async function syncCapturedLink(
  context: DestinationContext,
  bookmark: LinkItem,
  invalidCaptureMessage: string
) {
  const mapping = prepareLegacyLinkItemForSync(bookmark, {
    now: () => new Date(),
    createId: createDefaultKnowledgeItemId,
    normalizeUrl,
  });
  if (!mapping.success) throw new Error(invalidCaptureMessage);
  const response = await syncLinksToNotion(
    notionApi,
    notionConnectionFrom(context),
    [mapping.item],
    writeOptionsFor(context)
  );
  const failure = response.results.find((result) => !result.success);
  if (failure && !failure.success) throw new Error(failure.error || 'Notion did not save the page');
}

async function saveCurrentPage(
  source: CurrentPageCaptureSource = 'current_page',
  clickedTab?: chrome.tabs.Tab
): Promise<MessageResponse<'SAVE_CURRENT_PAGE'>> {
  const context = await readDestinationContext();
  try {
    if (!(await readNotionConnection())) return { success: false, error: 'Not connected' };

    // A context menu click names its tab; the popup saves the active tab of its window.
    const tab = clickedTab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || !tab.url || !tab.title) return { success: false, error: 'No active tab found' };
    if (!isWebPageUrl(tab.url)) return { success: false, error: 'Cannot save internal page' };

    const description = tab.id === undefined ? '' : await readTabDescription(tab.id, tab.url);
    const bookmark =
      source === 'current_page'
        ? formatCurrentPageForSync(
            { title: tab.title, url: tab.url, description },
            { createSyncId: () => createSyncId('quick-save'), defaultPath: 'Quick Saves' }
          )
        : formatSavedLinkForSync(
            { title: tab.title, url: tab.url, description, path: 'Quick Saves' },
            { createSyncId: () => createSyncId('quick-save'), source: 'context_menu' }
          );

    await syncCapturedLink(context, bookmark, 'Current page capture cannot be synced');
    await recordDestinationActivity(context, () => recordDashboardSave(source)).catch((error) =>
      console.warn('[saveCurrentPage] Saved, but dashboard activity was not recorded:', error)
    );
    return { success: true };
  } catch (error) {
    console.error('[saveCurrentPage] Failed:', error);
    const action = await recordConnectionFailure(context, error).catch(() => 'retry' as const);
    await recordDestinationActivity(context, () =>
      recordDashboardEvent({
        kind: 'error',
        source,
        result: 'failed',
        errorCategory: classifyDashboardError(error),
        action,
      })
    );
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

setupAutoSyncListener(async (context) => {
  await performBookmarkSync('auto', context);
});
restoreAutoSync((context) => performBookmarkSync('auto', context));

// Register the context menu click listener before its connection-derived state is applied.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== SAVE_TO_NOTION_CONTEXT_MENU_ID) return;
  if (!(await readNotionConnection())) return;

  // A page click saves the page; a link click saves only that link's URL.
  if (!info.linkUrl) {
    await saveCurrentPage('context_menu', tab);
    return;
  }
  const url = info.linkUrl;
  if (!isWebPageUrl(url)) return;
  const title = (info as { linkText?: string }).linkText || tab?.title || 'Untitled';
  const context = await readDestinationContext();
  try {
    const bookmark = formatSavedLinkForSync(
      { title, url, description: '', path: 'Quick Saves' },
      { createSyncId: () => createSyncId('quick-save'), source: 'context_menu' }
    );
    await syncCapturedLink(context, bookmark, 'Context menu capture cannot be synced');
    await recordDestinationActivity(context, () => recordDashboardSave('context_menu'));
  } catch (error) {
    console.error('[Context Menu] Save failed:', error);
    const action = await recordConnectionFailure(context, error).catch(() => 'retry' as const);
    await recordDestinationActivity(context, () =>
      recordDashboardEvent({
        kind: 'error',
        source: 'context_menu',
        result: 'failed',
        errorCategory: classifyDashboardError(error),
        action,
      })
    );
  }
});

// Keep destination-only actions aligned with the active connection.
void syncDestinationContextMenu();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || (!changes[NOTION_TOKEN_KEY] && !changes[NOTION_DATABASE_KEY])) return;
  void syncDestinationContextMenu();
});

async function messageDestinationContext(req: {
  destinationRevision?: string | null;
}): Promise<DestinationContext> {
  const context = await readDestinationContext();
  if ('destinationRevision' in req && req.destinationRevision !== context.revision)
    throw new StaleDestinationStateError();
  return context;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

addMessageListener({
  [Messages.SYNC_ALL_BOOKMARKS]: async (req) => {
    const context = await messageDestinationContext(req);
    return await performBookmarkSync('manual', context);
  },
  [Messages.SAVE_CURRENT_PAGE]: async () => await saveCurrentPage(),
  [Messages.GET_DASHBOARD_STATE]: async (req) => {
    try {
      const dashboard = await getDashboardSnapshot(req.refreshConnection === true);
      return { success: true, dashboard } as const;
    } catch (err) {
      if (!isStaleDestinationStateError(err))
        console.error('❌ Failed to build dashboard state:', err);
      return { success: false, error: errorMessage(err) } as const;
    }
  },
  [Messages.NOTION_LIST_TARGETS]: async (req) => {
    try {
      const token = req.token.trim();
      if (!token) throw new Error('Enter a Notion token');
      const [self, targets] = await Promise.all([
        notionApi.getSelf(token),
        notionApi.listTargets(token),
      ]);
      return { success: true, workspaceName: self.workspaceName, ...targets } as const;
    } catch (err) {
      return { success: false, error: errorMessage(err) } as const;
    }
  },
  [Messages.NOTION_CONNECT]: async (req) => {
    try {
      const context = await messageDestinationContext(req);
      const token = req.token.trim();
      if (!token) throw new Error('Enter a Notion token');
      if (req.databaseId !== undefined && !isNotionId(req.databaseId))
        throw new Error('Choose a Notion database');
      if (req.parentPageId !== undefined && !isNotionId(req.parentPageId))
        throw new Error('Choose a Notion page');
      // Check before creating anything, so a stale request leaves no extra database.
      await assertDestinationContextCurrent(context);
      const databaseId =
        req.databaseId ||
        (req.parentPageId
          ? (
              await notionApi.createBookmarkDatabase(
                token,
                req.parentPageId,
                DEFAULT_DATABASE_TITLE
              )
            ).databaseId
          : undefined);
      if (!databaseId) throw new Error('Choose a database or a page for the new database');
      const [verified, self] = await Promise.all([
        notionApi.verifyDatabaseAccess(databaseId, token),
        notionApi.getSelf(token).catch(() => ({ workspaceName: undefined })),
      ]);
      const database = {
        id: verified.databaseId,
        title: verified.title || DEFAULT_DATABASE_TITLE,
        ...(self.workspaceName ? { workspaceName: self.workspaceName } : {}),
      };
      const connected = await commitNotionConnection(context, { token, database });
      await recordDashboardEvent({ kind: 'connection_checked', result: 'success' });
      return { success: true, destinationRevision: connected.revision!, database } as const;
    } catch (err) {
      if (isStaleDestinationStateError(err))
        return { success: false, error: 'The Notion connection changed' } as const;
      return { success: false, error: errorMessage(err) } as const;
    }
  },
  [Messages.DISCONNECT_NOTION]: async (req) => {
    try {
      const context = await messageDestinationContext(req);
      const cleared = await clearNotionConnection(context);
      await scheduleAutoSync(false, 0);
      return { success: true, destinationRevision: cleared.revision! } as const;
    } catch (err) {
      return { success: false, error: errorMessage(err) } as const;
    }
  },
  [Messages.ORGANIZE_KEY_GET]: (_req, sender) =>
    handleOrganizeMessage(sender, async () => ({ key: await readOrganizeKeySummary() })),
  [Messages.ORGANIZE_KEY_SAVE]: (req, sender) =>
    handleOrganizeMessage(sender, async () => ({
      key: await saveOrganizeKey(req.provider, req.apiKey),
    })),
  [Messages.ORGANIZE_KEY_DELETE]: (_req, sender) =>
    handleOrganizeMessage(sender, async () => {
      await deleteOrganizeKey();
      return {};
    }),
  [Messages.ORGANIZE_PREVIEW_BATCH]: (req, sender) =>
    handleOrganizeMessage(sender, () => runOrganizeBatch(req.batch, req.uiLanguage)),
  [Messages.SCHEDULE_AUTO_SYNC]: async (req) => {
    try {
      const context = await messageDestinationContext(req);
      await withCurrentDestination(context, () => scheduleAutoSync(req.enabled, req.intervalHours));
      return { success: true } as const;
    } catch (err) {
      console.error('❌ Failed to schedule auto-sync:', err);
      return { success: false, error: errorMessage(err) } as const;
    }
  },
});

async function handleOrganizeMessage<T extends object>(
  sender: chrome.runtime.MessageSender,
  run: () => Promise<T>
): Promise<
  ({ success: true } & T) | { success: false; errorCode: OrganizeErrorCode; retryAfterMs?: number }
> {
  if (!isOrganizeSenderAllowed(sender)) return { success: false, errorCode: 'invalid_request' };
  try {
    return { success: true, ...(await run()) };
  } catch (error) {
    if (error instanceof OrganizeError) {
      return { success: false, errorCode: error.code, retryAfterMs: error.retryAfterMs };
    }
    // Provider responses and keys are never logged; only the failure kind is kept.
    console.error('❌ Library organization failed:', error instanceof Error ? error.name : error);
    return { success: false, errorCode: 'provider_request_failed' };
  }
}

// Open the options page when the user clicks the extension icon
try {
  chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
  });
} catch {
  // Some environments may not support action.onClicked in mocks; ignore
}
