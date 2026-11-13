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
  isStaleDestinationStateError,
  readDestinationContext,
  readNotionConnection,
  withCurrentDestination,
  type DestinationContext,
} from '../utils/destination-state';
import { notionApi } from '../destinations/notion/notion-api';
import { createTaskRuntime } from '../runtime';
import { registerOrganizeTask, createOrganizeTaskHandlers } from '../runtime/organize';
import { startRuntime, wireTaskRuntime } from '../runtime/chrome';
import { reconcileSyncProgress, registerNotionSyncTask, submitNotionSync } from './notion-runtime';
import {
  fillBookmarkDescriptionIfUnchanged,
  readBookmarkMetadata,
} from '../library/bookmark-metadata';
import { isDestinationContextCurrent } from '../utils/destination-state';
import { readTabDescription } from './page-description';
import { recordConnectionFailure } from './connection-health';
import { isNotionId } from '../destinations/notion/ids';
import {
  OrganizeError,
  deleteOrganizeKey,
  isOrganizeSenderAllowed,
  readOrganizeKeySummary,
  runAssignBatch,
  runFolderMap,
  saveOrganizeKey,
  type OrganizeErrorCode,
} from './library-organize';
import { addMessageListener, Messages, type MessageResponse } from '../utils/message';
import { scheduleAutoSync, setupAutoSyncListener, restoreAutoSync } from './auto-sync';
import { cleanupStorage } from '../utils/storage-cleanup';
import { getReadingListItems } from '../utils/reading-list';
import {
  classifyDashboardError,
  getDashboardSnapshot,
  recordDestinationActivity,
  recordDashboardEvent,
  recordDashboardSave,
} from './dashboard';
import { createSyncExecutionGate } from './sync-recovery';
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

const taskRuntime = createTaskRuntime();
registerOrganizeTask(taskRuntime);
registerNotionSyncTask(taskRuntime);
wireTaskRuntime(taskRuntime);
const backgroundInitialization = reconcileSyncProgress(taskRuntime)
  .catch((error) => {
    console.warn('[Background] Could not reconcile the sync progress marker:', error);
  })
  .then(() => startRuntime(taskRuntime))
  .then(() => cleanupStorage())
  .catch((error) => {
    console.warn('[Background] Initialization failed; continuing with sync available:', error);
  });

const runSyncOnce =
  createSyncExecutionGate<MessageResponse<'SYNC_ALL_BOOKMARKS'>>(backgroundInitialization);

async function queueBookmarkSync(trigger: 'manual' | 'auto', expectedContext?: DestinationContext) {
  const context = expectedContext ?? (await readDestinationContext());
  return runSyncOnce(() => collectAndQueueSync(trigger, context), context);
}

async function collectAndQueueSync(trigger: 'manual' | 'auto', context: DestinationContext) {
  await assertDestinationContextCurrent(context);
  if (!context.token || !context.databaseId)
    return { success: false, error: 'Not connected' } as const;
  const bookmarkTree = await chrome.bookmarks.getTree();
  const collected = await collectBookmarkSyncItems(bookmarkTree[0]?.children || []);
  const readingList = await getReadingListItems();
  const readingUrls = new Set(readingList.map((item) => item.url));
  const localLinks = withBookmarkType(collected.items).filter((item) => !readingUrls.has(item.url));
  const links = [...localLinks, ...readingList].map((item) =>
    prepareLegacyLinkItemForSync(item, {
      now: () => new Date(),
      createId: createDefaultKnowledgeItemId,
      normalizeUrl,
    })
  );
  if (links.some((item) => !item.success))
    throw new Error('Chrome bookmark capture cannot be synced');
  const valid = links.flatMap((item) => (item.success ? [item.item] : []));
  const fingerprint = await createSyncFingerprint([
    ...collected.fingerprintItems,
    ...toSyncFingerprintItems(readingList, 'Reading List'),
  ]);
  const taskId = await submitNotionSync(taskRuntime, context, {
    links: valid,
    trigger,
    fingerprint,
    payloadVersion: SYNC_SCHEMA_VERSION,
  });
  void taskRuntime.runner();
  return { success: true, queued: true, taskId } as const;
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
  const taskId = await submitNotionSync(taskRuntime, context, {
    links: [mapping.item],
    trigger: 'manual',
    capture: true,
  });
  void taskRuntime.runner();
  return taskId;
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
    if (description) {
      const matches = await chrome.bookmarks.search({ url: tab.url });
      const metadata = await readBookmarkMetadata();
      for (const match of matches) {
        await fillBookmarkDescriptionIfUnchanged(
          match.id,
          description,
          'page',
          metadata[match.id],
          () => isDestinationContextCurrent(context)
        );
      }
    }
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

    const taskId = await syncCapturedLink(
      context,
      bookmark,
      'Current page capture cannot be synced'
    );
    await recordDestinationActivity(context, () => recordDashboardSave(source)).catch((error) =>
      console.warn('[saveCurrentPage] Queued, but dashboard activity was not recorded:', error)
    );
    return { success: true, queued: true, taskId };
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
  await queueBookmarkSync('auto', context);
});
restoreAutoSync((context) => queueBookmarkSync('auto', context));

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
  ...createOrganizeTaskHandlers(taskRuntime),
  [Messages.SYNC_ALL_BOOKMARKS]: async (req) => {
    const context = await messageDestinationContext(req);
    return await queueBookmarkSync('manual', context);
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
  [Messages.ORGANIZE_MAP_FOLDERS]: (req, sender) =>
    handleOrganizeMessage(sender, () => runFolderMap(req.request)),
  [Messages.ORGANIZE_ASSIGN_BATCH]: (req, sender) =>
    handleOrganizeMessage(sender, () => runAssignBatch(req.items, req.uiLanguage)),
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
