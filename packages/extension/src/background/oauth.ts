import type { AccountContext } from '../utils/account-state';
import { config } from './config';
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

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

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

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectedTo) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`OAuth failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      if (!redirectedTo) {
        reject(new Error('No redirect URL returned - authorization may have been cancelled'));
        return;
      }
      resolve(redirectedTo);
    });
  });
}

export async function signInWithGoogle(context?: AccountContext) {
  const clientId = config.google?.clientId;
  if (!clientId) throw new Error('Google Client ID not configured');
  const redirectUri = chrome.identity.getRedirectURL('google');
  const state = crypto.randomUUID();
  const { verifier, challenge } = await createPkcePair();
  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const redirectedTo = await launchWebAuthFlow(
    `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`
  );
  const code = readAuthorizationCode(redirectedTo, redirectUri, state);
  return serverAPI.signInWithGoogle({ code, redirectUri, codeVerifier: verifier }, context);
}

export async function exchangeCodeForToken(
  code: string,
  context?: AccountContext
): Promise<{ success: boolean; accountRevision: string }> {
  const redirectUri = chrome.identity.getRedirectURL('callback');

  const response = await serverAPI.exchangeOAuthCode(code, redirectUri, context);
  return { success: true, accountRevision: response.accountRevision };
}
