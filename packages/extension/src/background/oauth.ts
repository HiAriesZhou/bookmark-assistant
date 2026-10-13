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

export async function exchangeCodeForToken(
  code: string,
  context?: AccountContext
): Promise<{ success: boolean; accountRevision: string }> {
  const redirectUri = chrome.identity.getRedirectURL('callback');

  const response = await serverAPI.exchangeOAuthCode(code, redirectUri, context);
  return { success: true, accountRevision: response.accountRevision };
}
