import { describe, expect, it } from 'vitest';
import { CHECKOUT_MESSAGE_SOURCE, checkoutEmbedUrl, isCheckoutEmbedMessage } from './checkout';

describe('checkout embed protocol', () => {
  it('accepts only known statuses from the checkout page', () => {
    expect(isCheckoutEmbedMessage({ source: CHECKOUT_MESSAGE_SOURCE, status: 'completed' })).toBe(
      true
    );
    expect(isCheckoutEmbedMessage({ source: CHECKOUT_MESSAGE_SOURCE, status: 'paid' })).toBe(false);
    expect(isCheckoutEmbedMessage({ source: 'other', status: 'completed' })).toBe(false);
    expect(isCheckoutEmbedMessage('completed')).toBe(false);
    expect(isCheckoutEmbedMessage(null)).toBe(false);
  });

  it('keeps the Paddle transaction and marks the link as embedded', () => {
    const url = new URL(checkoutEmbedUrl('https://www.example.com/checkout?_ptxn=txn_123'));
    expect(url.searchParams.get('_ptxn')).toBe('txn_123');
    expect(url.searchParams.get('embed')).toBe('1');
  });
});
