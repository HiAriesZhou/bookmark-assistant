/**
 * Paddle checkout for the extension. MV3 forbids remote scripts in extension pages and
 * Paddle.js must load from Paddle's CDN, so the extension never runs Paddle.js itself: the
 * server creates the transaction, and the settings page embeds the website checkout page,
 * which runs Paddle.js. A checkout window is the fallback.
 */

import { productConfig } from '../product-config';

export interface OpenCheckoutOptions {
  pricing: 'monthly' | 'yearly';
  userEmail?: string;
  userId: string;
  successUrl: string;
}

/**
 * Asks the server for a Paddle checkout URL (the website checkout page plus `?_ptxn=`).
 * The caller embeds it in the settings page or opens it in a checkout window.
 */
export async function createPaddleCheckoutUrl(options: OpenCheckoutOptions): Promise<string> {
  const { session_token } = await chrome.storage.local.get('session_token');
  const response = await fetch(`${productConfig.apiUrl}/api/paddle/checkout-url/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session_token || ''}`,
    },
    body: JSON.stringify({
      pricing: options.pricing,
      userId: options.userId,
      email: options.userEmail,
      source: 'extension',
      successUrl: options.successUrl,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create checkout URL');
  }
  const { checkoutUrl } = await response.json();
  if (!isCheckoutPageUrl(checkoutUrl)) throw new Error('The server did not return a checkout URL');
  return checkoutUrl;
}

/** HTTPS, or a local development site, before the page is embedded or opened. */
function isCheckoutPageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

/** A small top-level window for when the embedded checkout cannot open. */
export async function openCheckoutWindow(checkoutUrl: string): Promise<void> {
  await chrome.windows.create({ url: checkoutUrl, type: 'popup', width: 520, height: 760 });
}
