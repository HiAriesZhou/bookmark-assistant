// 🎫 Paddle Billing Integration for Extension

/**
 * Chrome Extension Checkout Strategy
 *
 * ❌ Problem: @paddle/paddle-js NPM package still loads CDN resources at runtime
 * ✅ Solution: Use Paddle Checkout API to generate checkout URLs and open in new tab
 *
 * Benefits:
 * - ✅ No CSP violations (no iframe/overlay in extension context)
 * - ✅ Full checkout experience in dedicated browser tab
 * - ✅ Better mobile support
 * - ✅ Simpler implementation
 * - ✅ No Paddle SDK initialization needed
 */

import { productConfig } from '../product-config';

export interface OpenCheckoutOptions {
  pricing: 'monthly' | 'yearly';
  userEmail?: string;
  userId: string;
  successUrl: string;
}

/**
 * Open Paddle checkout in a new browser tab
 * Uses server-side API to generate checkout URL to avoid CSP issues
 */
export async function openPaddleCheckout(options: OpenCheckoutOptions): Promise<void> {
  try {
    const serverUrl = productConfig.apiUrl;
    const { session_token } = await chrome.storage.local.get('session_token');

    console.log('🚀 Requesting Paddle checkout URL from server:', serverUrl);

    // Request checkout URL from server
    const response = await fetch(`${serverUrl}/api/paddle/checkout-url/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session_token || ''}`,
      },
      body: JSON.stringify({
        pricing: options.pricing,
        userId: options.userId,
        email: options.userEmail,
        source: 'extension', // Track that checkout originated from extension
        successUrl: options.successUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create checkout URL');
    }

    const { checkoutUrl } = await response.json();

    console.log('✅ Checkout URL received, opening in new tab...');

    // Open checkout in new tab
    chrome.tabs.create({ url: checkoutUrl });

    console.log('✅ Paddle checkout opened successfully');
  } catch (error) {
    console.error('❌ Failed to open Paddle checkout:', error);
    throw error;
  }
}
