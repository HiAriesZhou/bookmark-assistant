import { config, GOOGLE_SIGN_IN_CONFIG } from './config';
import { serverAPI } from './server-api';

// Debug function to help with OAuth setup
export function debugOAuthSetup() {
  const redirectUri = chrome.identity.getRedirectURL('callback');
  console.group('🔧 OAuth Debug Information');
  console.log('Extension ID:', chrome.runtime.id);
  console.log('Redirect URI:', redirectUri);
  console.log('Client ID configured:', !!config.notion.clientId);
  console.log(
    'Expected Notion redirect URI:',
    `https://${chrome.runtime.id}.chromiumapp.org/callback`
  );
  console.groupEnd();
}

export async function launchNotionOAuth() {
  const redirectUri = chrome.identity.getRedirectURL('callback');
  const clientId = config.notion.clientId;
  const state = crypto.randomUUID();

  if (!clientId) {
    throw new Error('Notion Client ID not configured');
  }

  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    owner: 'user',
    state,
  });

  const authUrl = `https://api.notion.com/v1/oauth/authorize?${authParams.toString()}`;

  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      async (redirectedTo) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          return reject(new Error(`OAuth failed: ${errorMessage}`));
        }

        if (!redirectedTo) {
          return reject(
            new Error('No redirect URL returned - authorization may have been cancelled')
          );
        }

        try {
          const url = new URL(redirectedTo);
          const expected = new URL(redirectUri);
          if (
            url.origin !== expected.origin ||
            url.pathname !== expected.pathname ||
            url.searchParams.get('state') !== state
          ) {
            return reject(
              new Error('OAuth callback did not match the pending authorization request')
            );
          }
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            return reject(new Error(`OAuth error: ${error}`));
          }

          if (!code) {
            return reject(new Error('No authorization code returned'));
          }

          resolve(code);
        } catch (parseError) {
          return reject(new Error(`Failed to parse redirect URL: ${parseError}`));
        }
      }
    );
  });
}

export async function exchangeCodeForToken(code: string): Promise<{ success: boolean }> {
  const redirectUri = chrome.identity.getRedirectURL('callback');

  const response = await serverAPI.exchangeOAuthCode(code, redirectUri);
  if (response.sessionToken) {
    return { success: true };
  }
  return { success: false };
}

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Reads the authorization code from a web auth redirect after checking it belongs to us. */
export function readAuthorizationCode(
  redirectedTo: string,
  redirectUri: string,
  state: string
): string {
  const url = new URL(redirectedTo);
  const expected = new URL(redirectUri);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.searchParams.get('state') !== state
  ) {
    throw new Error('OAuth callback did not match the pending authorization request');
  }
  const error = url.searchParams.get('error');
  if (error) throw new Error(`OAuth error: ${error}`);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code returned');
  return code;
}

/** Signs in to a Bookmark Assistant account with Google (authorization code + PKCE). */
export async function signInWithGoogle(): Promise<{ userId: string; userEmail?: string }> {
  if (!GOOGLE_SIGN_IN_CONFIG.clientId) throw new Error('Google sign-in is not configured');

  const redirectUri = chrome.identity.getRedirectURL('google');
  const state = crypto.randomUUID();
  const { verifier, challenge } = await createPkcePair();
  const authUrl = `${GOOGLE_AUTHORIZE_URL}?${new URLSearchParams({
    client_id: GOOGLE_SIGN_IN_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()}`;

  const redirectedTo = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!redirectedTo) throw new Error('Google sign-in was cancelled');

  const code = readAuthorizationCode(redirectedTo, redirectUri, state);
  return serverAPI.signInWithGoogle({ code, redirectUri, codeVerifier: verifier });
}
