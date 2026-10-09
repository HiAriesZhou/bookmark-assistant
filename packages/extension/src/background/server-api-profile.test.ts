import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverAPI } from './server-api';

const profile = {
  userId: 'user-123',
  isPro: false,
  plan: 'free' as const,
  subscriptionSource: null,
  expiresAt: null,
};

function profileResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ profile }),
  } as Response;
}

describe('ServerAPI user profile request coalescing', () => {
  let sessionToken: string;

  beforeEach(() => {
    sessionToken = 'session-one';
    (serverAPI as any).sessionToken = null;
    (serverAPI as any).userProfileCache = null;
    (serverAPI as any).userProfileRequest = null;
    (serverAPI as any).userProfileFailure = null;

    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension-id' },
      storage: {
        local: {
          get: vi.fn().mockImplementation(() => Promise.resolve({ session_token: sessionToken })),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(profileResponse()));
  });

  it('shares one network request across concurrent profile reads', async () => {
    const [first, second, third] = await Promise.all([
      serverAPI.getUserProfile(),
      serverAPI.getUserProfile(),
      serverAPI.getUserProfile({ forceRefresh: true }),
    ]);

    expect(first.user).toEqual(profile);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a recent profile for the same session', async () => {
    await serverAPI.getUserProfile();
    await serverAPI.getUserProfile();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bypasses the resolved cache for an explicit refresh', async () => {
    await serverAPI.getUserProfile();
    await serverAPI.getUserProfile({ forceRefresh: true });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a profile after the session changes', async () => {
    await serverAPI.getUserProfile();
    sessionToken = 'session-two';
    await serverAPI.getUserProfile();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failed profile request and still allows an explicit retry', async () => {
    const unavailable = new TypeError('Failed to fetch');
    vi.mocked(fetch).mockRejectedValue(unavailable);

    await expect(serverAPI.getUserProfile()).rejects.toBe(unavailable);
    await expect(serverAPI.getUserProfile()).rejects.toBe(unavailable);
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(serverAPI.getUserProfile({ forceRefresh: true })).rejects.toBe(unavailable);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
