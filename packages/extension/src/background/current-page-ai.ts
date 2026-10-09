import type { PageContent } from '../core';
import { normalizeUrl } from '../core';
import type { BookmarkSyncWriteResult } from './server-api';

export type PendingCurrentPageAi = {
  tabId: number;
  url: string;
  syncId: string;
  knowledgeItemId: string;
  expiresAt: number;
};

const CURRENT_PAGE_AI_STORAGE_KEY_PREFIX = 'pending_current_page_ai:';

function storageKey(requestId: string): string {
  return `${CURRENT_PAGE_AI_STORAGE_KEY_PREFIX}${requestId}`;
}

/** Store only metadata. Current-page body text must remain process-memory only. */
export async function createPendingCurrentPageAi(
  candidate: Omit<PendingCurrentPageAi, 'expiresAt'>,
  options: {
    requestId: string;
    expiresAt: number;
    storage?: chrome.storage.StorageArea;
  }
): Promise<string> {
  const storage = options.storage || chrome.storage.session;
  await storage.set({
    [storageKey(options.requestId)]: {
      ...candidate,
      expiresAt: options.expiresAt,
    } satisfies PendingCurrentPageAi,
  });
  return options.requestId;
}

/** Consume candidates once so a retry can never resend a page body silently. */
export async function consumePendingCurrentPageAi(
  requestId: string,
  now = Date.now(),
  storage: chrome.storage.StorageArea = chrome.storage.session
): Promise<PendingCurrentPageAi | undefined> {
  const key = storageKey(requestId);
  const stored = await storage.get(key);
  await storage.remove(key);
  const pending = stored[key] as PendingCurrentPageAi | undefined;
  if (!pending || pending.expiresAt <= now) return undefined;
  return pending;
}

export function wasCurrentPageCreated(results: BookmarkSyncWriteResult[], syncId: string): boolean {
  return results.some(
    (result) => result.success && result.action === 'created' && result.syncId === syncId
  );
}

/** The URL and body are read in one injected call to avoid a navigation race. */
export function extractedPageMatchesPending(
  pending: Pick<PendingCurrentPageAi, 'url'>,
  page: Pick<PageContent, 'url'> | undefined
): boolean {
  return !!page?.url && normalizeUrl(page.url) === normalizeUrl(pending.url);
}
