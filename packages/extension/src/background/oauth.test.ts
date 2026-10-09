import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./config', () => ({ config: { notion: { clientId: 'fixture-client' } } }));
vi.mock('./server-api', () => ({ serverAPI: { exchangeOAuthCode: vi.fn() } }));
import { launchNotionOAuth } from './oauth';

afterEach(() => vi.unstubAllGlobals());
const redirect = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/callback';
function setup(callback: (url: URL) => string) {
  vi.stubGlobal('chrome', {
    runtime: {},
    identity: {
      getRedirectURL: () => redirect,
      launchWebAuthFlow: ({ url }: { url: string }, done: (result: string) => void) =>
        done(callback(new URL(url))),
    },
  });
}
describe('OAuth callback binding', () => {
  it('accepts the code only for the same callback and generated state', async () => {
    setup((url) => `${redirect}?code=fixture-code&state=${url.searchParams.get('state')}`);
    await expect(launchNotionOAuth()).resolves.toBe('fixture-code');
  });
  it.each(['missing', 'mismatch', 'wrong-origin', 'wrong-path'])(
    'rejects %s before token exchange',
    async (kind) => {
      setup((url) =>
        kind === 'wrong-origin'
          ? `https://other.example/callback?code=fixture-code&state=${url.searchParams.get('state')}`
          : kind === 'wrong-path'
            ? `${redirect}/other?code=fixture-code&state=${url.searchParams.get('state')}`
            : `${redirect}?code=fixture-code${kind === 'mismatch' ? '&state=wrong' : ''}`
      );
      await expect(launchNotionOAuth()).rejects.toThrow('did not match');
    }
  );
});
