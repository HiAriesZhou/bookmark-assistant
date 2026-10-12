// 🔑 Google account sign-in (OAuth 2.0 authorization code flow with PKCE).

import { config } from '../config';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

export type GoogleIdentity = { sub: string; email: string };

export class GoogleSignInError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'GOOGLE_SIGN_IN_UNAVAILABLE'
      | 'GOOGLE_CODE_EXCHANGE_FAILED'
      | 'GOOGLE_IDENTITY_INVALID'
      | 'GOOGLE_EMAIL_UNVERIFIED'
  ) {
    super(message);
  }
}

export function isGoogleSignInConfigured(): boolean {
  return !!config.googleClientId && !!config.googleClientSecret;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) throw new GoogleSignInError('Malformed ID token', 'GOOGLE_IDENTITY_INVALID');
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleSignInError('Malformed ID token', 'GOOGLE_IDENTITY_INVALID');
  }
}

/**
 * Validates the ID token claims. The token comes directly from Google's token
 * endpoint over TLS in exchange for our client secret, so OpenID Connect allows
 * using it without a separate signature check; the claims are still verified.
 */
export function readGoogleIdentity(idToken: string, now = Date.now()): GoogleIdentity {
  const claims = decodeJwtPayload(idToken);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const expiresAtMs = typeof claims.exp === 'number' ? claims.exp * 1000 : 0;

  if (
    typeof claims.iss !== 'string' ||
    !GOOGLE_ISSUERS.has(claims.iss) ||
    !audience.includes(config.googleClientId) ||
    expiresAtMs <= now ||
    typeof claims.sub !== 'string' ||
    !claims.sub
  ) {
    throw new GoogleSignInError('Google identity could not be verified', 'GOOGLE_IDENTITY_INVALID');
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email) {
    throw new GoogleSignInError('Google account email is not verified', 'GOOGLE_EMAIL_UNVERIFIED');
  }
  return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
}

export async function exchangeGoogleCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleIdentity> {
  if (!isGoogleSignInConfigured()) {
    throw new GoogleSignInError(
      'Google sign-in is not configured on this server',
      'GOOGLE_SIGN_IN_UNAVAILABLE'
    );
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => ({}))) as { id_token?: unknown };
  if (!response.ok || typeof data.id_token !== 'string') {
    throw new GoogleSignInError(
      `Google token exchange failed (${response.status})`,
      'GOOGLE_CODE_EXCHANGE_FAILED'
    );
  }
  return readGoogleIdentity(data.id_token);
}
