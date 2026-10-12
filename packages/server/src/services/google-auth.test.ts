/**
 * Unit tests for Google ID token claim validation.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  config: { googleClientId: 'client.apps.googleusercontent.com', googleClientSecret: 'secret' },
}));

import { exchangeGoogleCode, readGoogleIdentity } from './google-auth';

const now = Date.parse('2026-10-12T00:00:00.000Z');

function idToken(claims: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: 'client.apps.googleusercontent.com',
  sub: 'google-sub-1',
  email: 'Person@Example.com',
  email_verified: true,
  exp: now / 1000 + 600,
};

describe('Google identity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the subject and normalized verified email', () => {
    expect(readGoogleIdentity(idToken(validClaims), now)).toEqual({
      sub: 'google-sub-1',
      email: 'person@example.com',
    });
  });

  it.each([
    ['another audience', { aud: 'other-client' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: now / 1000 - 1 }],
    ['a missing subject', { sub: '' }],
  ])('rejects %s', (_name, override) => {
    expect(() => readGoogleIdentity(idToken({ ...validClaims, ...override }), now)).toThrow(
      expect.objectContaining({ code: 'GOOGLE_IDENTITY_INVALID' })
    );
  });

  it('rejects an unverified email', () => {
    expect(() =>
      readGoogleIdentity(idToken({ ...validClaims, email_verified: false }), now)
    ).toThrow(expect.objectContaining({ code: 'GOOGLE_EMAIL_UNVERIFIED' }));
  });

  it('rejects a malformed token', () => {
    expect(() => readGoogleIdentity('not-a-jwt', now)).toThrow(
      expect.objectContaining({ code: 'GOOGLE_IDENTITY_INVALID' })
    );
  });

  it('sends the PKCE verifier and maps a failed exchange to a typed error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeGoogleCode({
        code: 'c',
        redirectUri: 'https://x.chromiumapp.org/google',
        codeVerifier: 'v',
      })
    ).rejects.toMatchObject({ code: 'GOOGLE_CODE_EXCHANGE_FAILED' });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('client_secret')).toBe('secret');
  });
});
