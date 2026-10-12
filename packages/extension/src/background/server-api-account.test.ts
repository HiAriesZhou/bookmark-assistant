import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverAPI } from './server-api';

const HOUR = 60 * 60 * 1000;
// Fresh enough not to trigger the once-a-day renewal.
const FRESH = 14 * 24 * HOUR - HOUR;

function sessionToken(expiresInMs: number, userId = 'acct-1') {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode({ userId, exp: (Date.now() + expiresInMs) / 1000 })}.sig`;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

let storage: Record<string, any>;

beforeEach(() => {
  storage = {};
  (serverAPI as any).sessionToken = null;
  (serverAPI as any).sessionRenewal = null;
  global.chrome = {
    runtime: { id: 'test-extension-id' },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in storage)
              .map((key) => [key, storage[key]])
          )
        ),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }),
      },
    },
  } as any;
});

const authorizationOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

describe('account session handling', () => {
  it('clears the local session without asking the server to change the account', async () => {
    storage.session_token = sessionToken(FRESH);
    storage.notion_connected = true;
    global.fetch = vi.fn();

    await serverAPI.logout();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(storage.session_token).toBeUndefined();
    expect(storage.notion_connected).toBeUndefined();
  });

  it('drops an expired session before a Notion exchange instead of sending it', async () => {
    storage.session_token = sessionToken(-HOUR);
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        sessionToken: sessionToken(14 * 24 * HOUR),
        userId: 'acct-2',
      })
    );

    await serverAPI.exchangeOAuthCode('code', 'https://ext.chromiumapp.org/callback');

    expect(global.fetch).toHaveBeenCalledOnce();
    expect(authorizationOf(vi.mocked(global.fetch).mock.calls[0])).toBeUndefined();
    expect(storage.notion_connected).toBe(true);
  });

  it('renews an aging session once and uses the new token for the request', async () => {
    const renewed = sessionToken(14 * 24 * HOUR);
    storage.session_token = sessionToken(2 * HOUR);
    global.fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/api/oauth/session')
          ? jsonResponse({ success: true, sessionToken: renewed })
          : jsonResponse({ pricing: { monthly: 1.5, yearly: 11.9, schemaVersion: 2 } })
      )
    ) as any;

    await serverAPI.getPricing().catch(() => undefined);

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(String(calls[0][0])).toMatch(/\/api\/oauth\/session$/);
    expect(authorizationOf(calls[1])).toBe(`Bearer ${renewed}`);
    expect(storage.session_token).toBe(renewed);
  });

  it('disconnects Notion but keeps the account session and plan', async () => {
    const current = sessionToken(FRESH);
    storage.session_token = current;
    storage.notion_connected = true;
    storage.last_sync_fingerprint = 'old';
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true }));

    await serverAPI.disconnectNotion();

    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toMatch(
      /\/api\/user\/notion\/disconnect$/
    );
    expect(storage.session_token).toBe(current);
    expect(storage.notion_connected).toBe(false);
    expect(storage.last_sync_fingerprint).toBeUndefined();
  });
});
