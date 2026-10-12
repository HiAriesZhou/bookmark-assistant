import { describe, expect, it } from 'vitest';
import { createPkcePair, readAuthorizationCode } from './oauth';

const redirectUri = 'https://extension-id.chromiumapp.org/google';

describe('account OAuth helpers', () => {
  it('derives an S256 PKCE challenge from a URL-safe verifier', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('accepts the code from the pending redirect', () => {
    expect(readAuthorizationCode(`${redirectUri}?state=s1&code=abc`, redirectUri, 's1')).toBe(
      'abc'
    );
  });

  it('rejects a redirect with another state or path', () => {
    expect(() =>
      readAuthorizationCode(`${redirectUri}?state=s2&code=abc`, redirectUri, 's1')
    ).toThrow('did not match');
    expect(() =>
      readAuthorizationCode(
        'https://extension-id.chromiumapp.org/callback?state=s1&code=abc',
        redirectUri,
        's1'
      )
    ).toThrow('did not match');
  });

  it('surfaces a provider error instead of a code', () => {
    expect(() =>
      readAuthorizationCode(`${redirectUri}?state=s1&error=access_denied`, redirectUri, 's1')
    ).toThrow('OAuth error: access_denied');
  });
});
