import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverAPI } from './server-api';
import { readAccountContext } from '../utils/account-state';

const HOUR = 60 * 60 * 1000;

function sessionToken(userId: string) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode({ userId, exp: (Date.now() + 14 * 24 * HOUR) / 1000 })}.sig`;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { resolve, promise };
}

let storage: Record<string, any>;

beforeEach(() => {
  storage = {};
  (serverAPI as any).sessionToken = null;
  (serverAPI as any).sessionRenewal = null;
  global.chrome = {
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (!keys) return { ...storage };
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            list.filter((key) => key in storage).map((key) => [key, storage[key]])
          );
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }),
      },
    },
  } as any;
});

describe('email sign-in account races', () => {
  it('drops a verification response that arrives after sign-out', async () => {
    const pending = deferred<Response>();
    global.fetch = vi.fn(() => pending.promise) as any;
    const context = await readAccountContext();
    const signingIn = serverAPI.verifyEmailSignIn('person@example.com', '424242', context);
    const failure = signingIn.catch((error) => error);
    await serverAPI.logout();
    pending.resolve(
      jsonResponse({
        success: true,
        sessionToken: sessionToken('late-account'),
        userId: 'late-account',
        userEmail: 'person@example.com',
        accountCreated: true,
      })
    );
    await expect(failure).resolves.toMatchObject({ code: 'STALE_ACCOUNT_STATE' });
    expect(storage.session_token).toBeUndefined();
    expect(storage.user_email).toBeUndefined();
  });

  it('drops a verification response that arrives after a different account signs in', async () => {
    const pending = deferred<Response>();
    global.fetch = vi.fn(() => pending.promise) as any;
    const context = await readAccountContext();
    const signingIn = serverAPI.verifyEmailSignIn('person@example.com', '424242', context);
    const failure = signingIn.catch((error) => error);
    const current = sessionToken('current-account');
    storage.session_token = current;
    storage.account_state_revision = 'revision-2';
    storage.user_id = 'current-account';
    pending.resolve(
      jsonResponse({
        success: true,
        sessionToken: sessionToken('late-account'),
        userId: 'late-account',
        userEmail: 'late@example.com',
      })
    );
    await expect(failure).resolves.toMatchObject({ code: 'STALE_ACCOUNT_STATE' });
    expect(storage.session_token).toBe(current);
    expect(storage.user_id).toBe('current-account');
  });
});
