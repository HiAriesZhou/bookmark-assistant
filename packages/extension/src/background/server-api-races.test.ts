import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { serverAPI } from './server-api';
import { useAppStore } from '../options/store';
import { deleteServiceAccount } from '../options/account-actions';
import { setupAutoSyncListener, restoreAutoSync } from './auto-sync';
import { getDashboardSnapshot } from './dashboard';
import {
  processPendingSyncEnrichment,
  SYNC_ENRICHMENT_JOB_KEY,
  SYNC_ENRICHMENT_STATE_KEY,
} from './sync-enrichment';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { resolve, reject, promise };
}
const profileA = {
  userId: 'account-a',
  email: 'a@example.invalid',
  isPro: true,
  plan: 'pro',
  hasNotionAccess: true,
  subscriptionSource: null,
  expiresAt: null,
};
const profileB = {
  ...profileA,
  userId: 'account-b',
  email: 'b@example.invalid',
  isPro: false,
  plan: 'free',
};
const response = (value: unknown, status = 200) =>
  ({
    ok: status === 200,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => value,
  }) as Response;
let stored: Record<string, any>;
let local: any;
beforeEach(() => {
  stored = {
    session_token: 'session-a',
    user_id: 'account-a',
    user_email: profileA.email,
    notion_connected: true,
  };
  local = {
    get: vi.fn(async () => ({ ...stored })),
    set: vi.fn(async (patch) => {
      Object.assign(stored, patch);
    }),
    remove: vi.fn(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    }),
  };
  vi.stubGlobal('chrome', {
    bookmarks: { getTree: vi.fn(async () => []) },
    readingList: { query: vi.fn(async () => []) },
    alarms: {
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true),
      get: vi.fn(async () => undefined),
      onAlarm: { addListener: vi.fn() },
    },
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ permissions: ['readingList'] }),
      sendMessage: vi.fn(async (msg) => {
        if (msg.type === 'GET_USER_PROFILE') {
          try {
            const result = await serverAPI.getUserProfile({ forceRefresh: msg.forceRefresh });
            return { success: true, profile: result.user, isPro: result.isPro };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }
        if (msg.type === 'DELETE_ACCOUNT') {
          await serverAPI.deleteAccount();
          return { success: true };
        }
        throw new Error('unexpected message ' + msg.type);
      }),
    },
    storage: { local },
  });
  Object.assign(serverAPI, {
    sessionToken: null,
    userProfileCache: null,
    userProfileRequest: null,
    userProfileFailure: null,
    sessionRenewal: null,
  });
  useAppStore.setState({
    isSignedIn: true,
    isConnected: true,
    isPro: true,
    plan: 'pro',
    userId: 'account-a',
    userEmail: profileA.email,
    isRefreshingProfile: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ profile: profileA }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account request ownership', () => {
  it('discards a profile after completed logout', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const old = serverAPI.getUserProfile();
    await started.promise;
    await serverAPI.logout();
    expect(stored.session_token).toBeUndefined();
    pending.resolve(response({ profile: profileA }));
    await expect(old).rejects.toMatchObject({ code: 'STALE_ACCOUNT_STATE' });
    expect((serverAPI as any).userProfileCache).toBeNull();
    expect(stored.user_email).toBeUndefined();
  });
  it('does not restore deleted account state or entitlement cache', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/api/user/profile')) {
        started.resolve();
        return pending.promise;
      }
      return response({ success: true });
    });
    const refresh = useAppStore.getState().refreshEntitlements(true);
    await started.promise;
    await deleteServiceAccount(async () => undefined);
    expect(useAppStore.getState().isSignedIn).toBe(false);
    expect(stored.session_token).toBeUndefined();
    pending.resolve(response({ profile: profileA }));
    await refresh;
    expect(useAppStore.getState().isSignedIn).toBe(false);
    expect(useAppStore.getState().userEmail).toBe('');
    expect(useAppStore.getState().isPro).toBe(false);
    expect(stored.is_pro).toBeUndefined();
    expect(stored.session_token).toBeUndefined();
  });
  it('does not let an old 401 clear the new account', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch)
      .mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      })
      .mockResolvedValueOnce(response({ profile: profileB }));
    const old = serverAPI.getUserProfile();
    const oldError = old.catch((e) => e);
    await started.promise;
    stored.session_token = 'session-b';
    stored.user_id = 'account-b';
    expect((await serverAPI.getUserProfile()).user.userId).toBe('account-b');
    pending.resolve(response({ message: 'Invalid session token' }, 401));
    expect((await oldError).code).toBe('STALE_ACCOUNT_STATE');
    expect(stored.session_token).toBe('session-b');
    expect(stored.user_id).toBe('account-b');
  });
  it('does not restore a disconnected destination', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/api/user/profile')) {
        started.resolve();
        return pending.promise;
      }
      return response({ success: true });
    });
    const old = serverAPI.getUserProfile();
    await started.promise;
    await serverAPI.disconnectNotion();
    expect(stored.notion_connected).toBe(false);
    pending.resolve(response({ profile: profileA }));
    await expect(old).rejects.toMatchObject({ code: 'STALE_ACCOUNT_STATE' });
    expect(stored.notion_connected).toBe(false);
  });
  it('caches valid profile results after same-account renewal', async () => {
    const token = (days: number) =>
      'header.' +
      btoa(
        JSON.stringify({ userId: 'account-a', exp: Math.floor(Date.now() / 1000) + days * 86400 })
      ) +
      '.signature';
    stored.session_token = token(2);
    const renewed = token(14);
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith('/api/oauth/session')
        ? response({ sessionToken: renewed })
        : response({ profile: profileA })
    );
    expect((await serverAPI.getUserProfile()).user).toEqual(profileA);
    expect(stored.session_token).toBe(renewed);
    expect((serverAPI as any).userProfileCache.value.user).toEqual(profileA);
  });
  it('ignores a profile message queued before account deletion but delivered afterward', async () => {
    const reply = deferred<any>(),
      started = deferred<void>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => {
      started.resolve();
      return reply.promise;
    });
    const refresh = useAppStore.getState().refreshEntitlements(true);
    await started.promise;
    await deleteServiceAccount(async () => undefined);
    reply.resolve({ success: true, profile: profileA });
    await refresh;
    expect(useAppStore.getState().isSignedIn).toBe(false);
    expect(stored.is_pro).toBeUndefined();
  });
  it('ignores an old credential failure after another request renews the same account', async () => {
    const token = (days: number) =>
      'header.' +
      btoa(
        JSON.stringify({ userId: 'account-a', exp: Math.floor(Date.now() / 1000) + days * 86400 })
      ) +
      '.signature';
    stored.session_token = token(14);
    const original = stored.session_token;
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const old = serverAPI.getUserProfile();
    const failure = old.catch((e) => e);
    await started.promise;
    const renewed = token(15);
    stored.session_token = renewed;
    pending.resolve(response({ message: 'Invalid session token' }, 401));
    expect((await failure).code).toBe('STALE_ACCOUNT_STATE');
    expect(stored.session_token).not.toBe(original);
    expect(stored.session_token).toBe(renewed);
    vi.mocked(fetch).mockResolvedValue(response({ profile: profileA }));
    await expect(serverAPI.getUserProfile()).resolves.toMatchObject({ user: profileA });
  });

  it('does not overwrite a newer profile after same-account credentials rotate', async () => {
    const token = (days: number) =>
      'header.' +
      btoa(
        JSON.stringify({ userId: 'account-a', exp: Math.floor(Date.now() / 1000) + days * 86400 })
      ) +
      '.signature';
    stored.session_token = token(14);
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const old = serverAPI.getUserProfile();
    const oldResult = old.catch((e) => e);
    await started.promise;
    stored.session_token = token(15);
    const newer = { ...profileA, isPro: false, plan: 'free', email: 'newer@example.invalid' };
    vi.mocked(fetch).mockResolvedValue(response({ profile: newer }));
    await serverAPI.getUserProfile({ forceRefresh: true });
    pending.resolve(response({ profile: profileA }));
    expect((await oldResult).code).toBe('STALE_ACCOUNT_STATE');
    expect(stored.is_pro).toBe(false);
    expect(stored.user_email).toBe(newer.email);
    expect((serverAPI as any).userProfileCache.value.user).toEqual(newer);
  });

  it('clears a current-account authentication failure', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ message: 'Invalid session token' }, 401));
    await expect(serverAPI.getUserProfile()).rejects.toMatchObject({ status: 401 });
    expect(stored.session_token).toBeUndefined();
    expect(stored.is_pro).toBe(false);
  });
  it.each([
    ['delete', () => serverAPI.deleteAccount()],
    ['disconnect', () => serverAPI.disconnectNotion()],
    ['OAuth', () => serverAPI.exchangeOAuthCode('synthetic-code', 'https://test.invalid/callback')],
  ] as const)(
    'does not send %s with an account selected during request preparation',
    async (_name, operation) => {
      local.get.mockImplementationOnce(async () => {
        const original = { ...stored };
        stored.session_token = 'session-b';
        stored.user_id = 'account-b';
        return original;
      });
      await expect(operation()).rejects.toMatchObject({ code: 'STALE_ACCOUNT_STATE' });
      expect(fetch).not.toHaveBeenCalled();
      expect(stored.session_token).toBe('session-b');
    }
  );
  it.each([
    ['delete', () => serverAPI.deleteAccount()],
    ['disconnect', () => serverAPI.disconnectNotion()],
    ['OAuth', () => serverAPI.exchangeOAuthCode('synthetic-code', 'https://test.invalid/callback')],
  ] as const)(
    'discards an old %s completion after a different account signs in',
    async (_name, operation) => {
      const pending = deferred<Response>(),
        started = deferred<void>();
      vi.mocked(fetch).mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const old = operation();
      const error = old.catch((e) => e);
      await started.promise;
      stored.session_token = 'session-b';
      stored.user_id = 'account-b';
      pending.resolve(response({ success: true, sessionToken: 'session-c', userId: 'account-c' }));
      expect((await error).code).toBe('STALE_ACCOUNT_STATE');
      expect(stored.session_token).toBe('session-b');
      expect(stored.user_id).toBe('account-b');
    }
  );
  it('lets a valid profile discover that Notion was linked on another device', async () => {
    stored.notion_connected = false;
    await useAppStore.getState().refreshEntitlements(true);
    expect(useAppStore.getState().isConnected).toBe(true);
    expect(stored.notion_connected).toBe(true);
  });
  it('does not let an old refresh end the new account refresh spinner', async () => {
    const first = deferred<any>(),
      second = deferred<any>(),
      started = deferred<void>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    const old = useAppStore.getState().refreshEntitlements(true);
    await started.promise;
    stored.session_token = 'session-b';
    stored.user_id = 'account-b';
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => second.promise);
    const current = useAppStore.getState().refreshEntitlements(true);
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2));
    first.resolve({ success: true, profile: profileA });
    await old;
    expect(useAppStore.getState().isRefreshingProfile).toBe(true);
    second.resolve({ success: true, profile: profileB });
    await current;
    expect(useAppStore.getState().userEmail).toBe(profileB.email);
    expect(useAppStore.getState().isRefreshingProfile).toBe(false);
  });
  it('ignores a refresh superseded during its final account check', async () => {
    const checking = deferred<void>(),
      releaseCheck = deferred<Record<string, unknown>>();
    local.get
      .mockImplementationOnce(async () => ({ ...stored }))
      .mockImplementationOnce(() => {
        checking.resolve();
        return releaseCheck.promise;
      });
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      profile: profileA,
    });
    const old = useAppStore.getState().refreshEntitlements(true);
    await checking.promise;
    const newer = { ...profileA, email: 'newer@example.invalid', isPro: false, plan: 'free' };
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({ success: true, profile: newer });
    await useAppStore.getState().refreshEntitlements(true);
    releaseCheck.resolve({ ...stored });
    await old;
    expect(useAppStore.getState().userEmail).toBe(newer.email);
    expect(useAppStore.getState().isPro).toBe(false);
  });

  it.each([
    [
      'hosted Free',
      {
        ...profileA,
        isPro: false,
        plan: 'free',
        deploymentMode: 'hosted',
        commerceEnabled: true,
        capabilities: { autoSync: false, batchAi: false },
      },
    ],
    [
      'hosted Pro',
      {
        ...profileA,
        deploymentMode: 'hosted',
        commerceEnabled: true,
        capabilities: { autoSync: true, batchAi: true },
      },
    ],
    [
      'self-hosted',
      {
        ...profileA,
        isPro: false,
        plan: 'free',
        deploymentMode: 'self-hosted',
        commerceEnabled: false,
        capabilities: { autoSync: true, batchAi: true },
      },
    ],
  ])('keeps server capability boundaries for %s', async (_name, profile) => {
    vi.mocked(fetch).mockResolvedValue(response({ profile }));
    await useAppStore.getState().refreshEntitlements(true);
    expect(useAppStore.getState()).toMatchObject({
      isPro: profile.isPro,
      commerceEnabled: profile.commerceEnabled,
      capabilities: profile.capabilities,
    });
    expect(stored.deployment_profile.capabilities).toEqual(profile.capabilities);
  });
  it.each(['alarm', 'restore'] as const)(
    'discards obsolete %s auto-sync checks without disabling the new account',
    async (kind) => {
      stored.auto_sync_enabled = true;
      stored.auto_sync_interval_minutes = 360;
      const pending = deferred<any>(),
        started = deferred<void>();
      vi.spyOn(serverAPI, 'getUserProfile').mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const sync = vi.fn(async () => undefined);
      let work: Promise<unknown>;
      if (kind === 'alarm') {
        setupAutoSyncListener(sync);
        const listener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];
        work = listener({
          name: 'bookmarks-auto-sync',
        } as chrome.alarms.Alarm) as unknown as Promise<void>;
      } else work = restoreAutoSync(sync);
      await started.promise;
      stored.session_token = 'session-b';
      stored.user_id = 'account-b';
      pending.reject(new TypeError('old request failed'));
      await work;
      expect(stored.auto_sync_enabled).toBe(true);
      expect(chrome.alarms.clear).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
    }
  );
  it('starts a new account dashboard independently and ignores the old reply', async () => {
    const first = deferred<any>(),
      second = deferred<any>(),
      started = deferred<void>();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    const old = useAppStore.getState().refreshDashboard();
    await started.promise;
    stored.session_token = 'session-b';
    stored.user_id = 'account-b';
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => second.promise);
    const current = useAppStore.getState().refreshDashboard();
    await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2));
    first.resolve({
      success: true,
      dashboard: {
        connection: { status: 'connected' },
        library: { bookmarks: 100 },
        sync: { inProgress: true, autoSyncEnabled: true },
      },
    });
    await old;
    expect(useAppStore.getState().isDashboardLoading).toBe(true);
    second.resolve({
      success: true,
      dashboard: {
        connection: { status: 'disconnected' },
        library: { bookmarks: 2 },
        sync: { inProgress: false, autoSyncEnabled: false },
      },
    });
    await current;
    expect(useAppStore.getState().bookmarkCount).toBe(2);
    expect(useAppStore.getState().isDashboardLoading).toBe(false);
  });

  it('does not cache an obsolete connection snapshot', async () => {
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const snapshot = getDashboardSnapshot(true);
    const failure = snapshot.catch((e) => e);
    await started.promise;
    await serverAPI.logout();
    pending.resolve(response({ profile: { ...profileA, hasNotionDatabase: true } }));
    expect((await failure).code).toBe('STALE_ACCOUNT_STATE');
    expect(stored.dashboard_connection).toBeUndefined();
    expect(stored.dashboard_snapshot).toBeUndefined();
    expect(stored.dashboard_recent_activity).toBeUndefined();
  });
  it('does not resurrect enrichment work after account removal', async () => {
    stored[SYNC_ENRICHMENT_JOB_KEY] = {
      id: 'old-job',
      items: [
        {
          title: 'Synthetic item',
          url: 'https://example.invalid/item',
          syncId: 'synthetic-item',
          notionPageId: 'synthetic-page',
          action: 'created',
        },
      ],
      attempts: 0,
      createdAt: '2026-10-13T00:00:00Z',
    };
    const pending = deferred<Response>(),
      started = deferred<void>();
    vi.mocked(fetch).mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const work = processPendingSyncEnrichment();
    await started.promise;
    await serverAPI.logout();
    pending.resolve(
      response({ summary: { total: 1, generated: 1 }, aiPlanning: { status: 'planned' } })
    );
    await work;
    expect(stored[SYNC_ENRICHMENT_JOB_KEY]).toBeUndefined();
    expect(stored[SYNC_ENRICHMENT_STATE_KEY]).toBeUndefined();
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
  it('serializes a delayed profile cache commit before logout clears it', async () => {
    const written = deferred<void>(),
      release = deferred<void>();
    local.set.mockImplementationOnce(async (patch: Record<string, unknown>) => {
      written.resolve();
      await release.promise;
      Object.assign(stored, patch);
    });
    const profile = serverAPI.getUserProfile();
    await written.promise;
    const logout = serverAPI.logout();
    release.resolve();
    await Promise.all([profile, logout]);
    expect(stored.session_token).toBeUndefined();
    expect(stored.is_pro).toBeUndefined();
    expect(stored.user_email).toBeUndefined();
  });
});
