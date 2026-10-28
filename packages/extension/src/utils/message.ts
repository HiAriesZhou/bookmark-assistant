/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { DashboardSnapshot } from '../dashboard/types';
import type { NotionDatabaseRef } from './destination-state';

export type NotionTargetSummary = { id: string; title: string };

// Centralized typed messaging between Options/Popup and Background.
// Requests that change destination state carry the revision the caller saw, so the
// background can reject them after the connection changed elsewhere.
export type MessageMap = {
  SYNC_ALL_BOOKMARKS: {
    req: { destinationRevision?: string | null };
    res: { success: boolean; error?: string; noChanges?: boolean };
  };
  NOTION_LIST_TARGETS: {
    req: { token: string };
    res: {
      success: boolean;
      error?: string;
      workspaceName?: string;
      databases?: NotionTargetSummary[];
      pages?: NotionTargetSummary[];
    };
  };
  NOTION_CONNECT: {
    req: {
      token: string;
      databaseId?: string;
      parentPageId?: string;
      destinationRevision?: string | null;
    };
    res: {
      success: boolean;
      error?: string;
      destinationRevision?: string;
      database?: NotionDatabaseRef;
    };
  };
  DISCONNECT_NOTION: {
    req: { destinationRevision?: string | null };
    res: { success: boolean; error?: string; destinationRevision?: string };
  };
  SCHEDULE_AUTO_SYNC: {
    req: { enabled: boolean; intervalHours: number; destinationRevision?: string | null };
    res: { success: boolean; error?: string };
  };
  SAVE_CURRENT_PAGE: {
    req: {};
    res: { success: boolean; error?: string };
  };
  GET_DASHBOARD_STATE: {
    req: { refreshConnection?: boolean };
    res: { success: boolean; dashboard?: DashboardSnapshot; error?: string };
  };
};

export type MessageType = keyof MessageMap;

export type MessageRequest<T extends MessageType> = { type: T } & MessageMap[T]['req'];
export type MessageResponse<T extends MessageType> = MessageMap[T]['res'];

// Optional convenience constant for autocomplete and ref safety
export const Messages: { [K in MessageType]: K } = {
  SYNC_ALL_BOOKMARKS: 'SYNC_ALL_BOOKMARKS',
  NOTION_LIST_TARGETS: 'NOTION_LIST_TARGETS',
  NOTION_CONNECT: 'NOTION_CONNECT',
  DISCONNECT_NOTION: 'DISCONNECT_NOTION',
  SCHEDULE_AUTO_SYNC: 'SCHEDULE_AUTO_SYNC',
  SAVE_CURRENT_PAGE: 'SAVE_CURRENT_PAGE',
  GET_DASHBOARD_STATE: 'GET_DASHBOARD_STATE',
};

// Connecting verifies the token, may create a database and checks access.
export const NOTION_CONNECT_MESSAGE_TIMEOUT_MS = 60_000;
// Saving one page writes a single Notion row and should acknowledge quickly.
export const SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS = 120_000;

export async function sendMessage<T extends MessageType>(
  message: MessageRequest<T>,
  opts?: { timeoutMs?: number }
): Promise<MessageResponse<T>> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const useTimeout = timeoutMs > 0;
  const controller = useTimeout ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const p = chrome.runtime.sendMessage(message as any) as Promise<any>;
    const res = controller
      ? await Promise.race([
          p,
          new Promise((_resolve, reject) =>
            controller.signal.addEventListener('abort', () => reject(new Error('REQUEST_TIMEOUT')))
          ),
        ])
      : await p;
    return res as MessageResponse<T>;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Background-side: add a single, typed message listener for a map of handlers
export function addMessageListener(
  handlers: Partial<{
    [K in MessageType]: (
      req: MessageRequest<K>,
      sender: chrome.runtime.MessageSender
    ) => Promise<MessageResponse<K>> | MessageResponse<K>;
  }>
) {
  const listener = (
    msg: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    const type: MessageType | undefined = msg?.type;
    if (!type) return; // not ours
    const handler = handlers[type] as any;
    if (!handler) return; // not handled here
    (async () => {
      try {
        const res = await handler(msg, sender);
        sendResponse(res);
      } catch (err) {
        // Best-effort normalize to string error
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Shape fallback for unknown message types (won't happen with provided map)
        sendResponse({ ok: false, success: false, error: errorMsg });
      }
    })();
    return true; // async response
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
