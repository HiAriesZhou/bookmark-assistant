/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { AiGenerationStatus } from '@bookmark-assistant/types';
import type { DashboardSnapshot } from '../dashboard/types';

/** Current-page AI outcomes: server task statuses plus decisions made locally. */
export type CurrentPageAiStatus =
  | AiGenerationStatus
  | 'not_started'
  | 'not_configured'
  | 'needs_attention'
  | 'skipped_ineligible_page'
  | 'skipped_navigation_changed'
  | 'skipped_insufficient_content'
  | 'skipped_fetch_disallowed';
// Centralized typed messaging between Options/Content and Background
// Define request/response contracts as a discriminated union

export type MessageMap = {
  NOTION_OAUTH: {
    req: { accountRevision?: string | null };
    res: { success: boolean; error?: string; accountRevision?: string };
  };
  SYNC_ALL_BOOKMARKS: {
    req: { accountRevision?: string | null };
    res: { success: boolean; error?: string; noChanges?: boolean };
  };
  GET_USER_PROFILE: {
    req: { forceRefresh?: boolean };
    res: { success: boolean; profile?: any; error?: string };
  };
  GET_PRICING: {
    req: {};
    res: {
      success: boolean;
      pricing?: { monthly: number; yearly: number };
      limits?: any;
      error?: string;
    };
  };
  DISCONNECT_NOTION: {
    req: { accountRevision?: string | null };
    res: { success: boolean; error?: string; accountRevision?: string };
  };
  DELETE_ACCOUNT: {
    req: { accountRevision?: string | null };
    res: { success: boolean; error?: string; accountRevision?: string };
  };
  RESTORE_PURCHASE: {
    req: { email: string };
    res: { success: boolean; message?: string; error?: string };
  };
  GET_PORTAL_LINK: { req: {}; res: { success: boolean; url?: string; error?: string } };
  CANCEL_SUBSCRIPTION: { req: {}; res: { success: boolean; error?: string } };
  GET_SUBSCRIPTION_INFO: {
    req: {};
    res: { success: boolean; nextBillingDate?: string; status?: string; error?: string };
  };
  SCHEDULE_AUTO_SYNC: {
    req: { enabled: boolean; intervalHours: number; accountRevision?: string | null };
    res: { success: boolean; error?: string };
  };
  SAVE_CURRENT_PAGE: {
    req: {};
    res: {
      success: boolean;
      error?: string;
      aiStatus?: CurrentPageAiStatus | 'pending';
      aiRequestId?: string;
    };
  };
  GENERATE_CURRENT_PAGE_AI: {
    req: { aiRequestId: string };
    res: { success: boolean; error?: string; aiStatus?: CurrentPageAiStatus };
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
  NOTION_OAUTH: 'NOTION_OAUTH',
  SYNC_ALL_BOOKMARKS: 'SYNC_ALL_BOOKMARKS',
  GET_USER_PROFILE: 'GET_USER_PROFILE',
  GET_PRICING: 'GET_PRICING',
  DISCONNECT_NOTION: 'DISCONNECT_NOTION',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  RESTORE_PURCHASE: 'RESTORE_PURCHASE',
  GET_PORTAL_LINK: 'GET_PORTAL_LINK',
  CANCEL_SUBSCRIPTION: 'CANCEL_SUBSCRIPTION',
  GET_SUBSCRIPTION_INFO: 'GET_SUBSCRIPTION_INFO',
  SCHEDULE_AUTO_SYNC: 'SCHEDULE_AUTO_SYNC',
  SAVE_CURRENT_PAGE: 'SAVE_CURRENT_PAGE',
  GENERATE_CURRENT_PAGE_AI: 'GENERATE_CURRENT_PAGE_AI',
  GET_DASHBOARD_STATE: 'GET_DASHBOARD_STATE',
};

// Notion OAuth can include template duplication and server-side database resolution.
export const OAUTH_MESSAGE_TIMEOUT_MS = 300_000;
// Base Notion capture is independent from AI and should acknowledge quickly.
export const SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS = 120_000;
// A separate message keeps the user-visible AI phase bounded without delaying
// the successful save acknowledgement.
export const GENERATE_CURRENT_PAGE_AI_MESSAGE_TIMEOUT_MS = 4 * 60_000;

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

export async function sendMessageToTab<T extends MessageType>(
  tabId: number,
  message: MessageRequest<T>,
  opts?: { timeoutMs?: number }
): Promise<MessageResponse<T>> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const useTimeout = timeoutMs > 0;
  const controller = useTimeout ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const p = chrome.tabs.sendMessage(tabId, message as any) as Promise<any>;
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
