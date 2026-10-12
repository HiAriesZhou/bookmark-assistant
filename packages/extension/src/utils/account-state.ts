// Account session and Notion destination state shared by background and UI.
//
// `session_token` identifies the service account created by connecting Notion.
// Disconnecting Notion keeps that session (and the plan), so the destination is
// recorded separately in `notion_connected`.

export const NOTION_CONNECTED_KEY = 'notion_connected';

// Sessions last 14 days; renew once a day while the extension is in use.
const SESSION_RENEW_WHEN_REMAINING_MS = 13 * 24 * 60 * 60 * 1000;

type StoredAccountState = { session_token?: unknown; notion_connected?: unknown };

export function hasNotionDestination(stored: StoredAccountState): boolean {
  if (!stored.session_token) return false;
  // Sessions created before this field existed always had Notion connected.
  return typeof stored.notion_connected === 'boolean' ? stored.notion_connected : true;
}

export async function readNotionDestination(): Promise<boolean> {
  const stored = await chrome.storage.local.get(['session_token', NOTION_CONNECTED_KEY]);
  return hasNotionDestination(stored);
}

export function readSessionExpiry(token: string): number | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function shouldRenewSession(token: string, now = Date.now()): boolean {
  const expiresAt = readSessionExpiry(token);
  if (expiresAt === null || expiresAt <= now) return false;
  return expiresAt - now < SESSION_RENEW_WHEN_REMAINING_MS;
}
