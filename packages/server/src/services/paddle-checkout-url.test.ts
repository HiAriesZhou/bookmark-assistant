import { describe, expect, it } from 'vitest';
import { resolvePaddleCheckoutUrl } from './paddle-checkout-url';

describe('resolvePaddleCheckoutUrl', () => {
  it('sends buyers to the website checkout page', () => {
    expect(resolvePaddleCheckoutUrl({ websiteUrl: 'https://www.bookmarkassistant.com' })).toBe(
      'https://www.bookmarkassistant.com/checkout'
    );
  });

  it('prefers an explicit checkout page', () => {
    expect(
      resolvePaddleCheckoutUrl({
        checkoutUrl: 'https://pay.example.com/start',
        websiteUrl: 'https://www.bookmarkassistant.com',
      })
    ).toBe('https://pay.example.com/start');
  });

  it("keeps Paddle's default payment link for local or non-HTTPS sites", () => {
    expect(resolvePaddleCheckoutUrl({ websiteUrl: 'http://localhost:3006' })).toBeUndefined();
    expect(resolvePaddleCheckoutUrl({ checkoutUrl: 'not a url' })).toBeUndefined();
    expect(resolvePaddleCheckoutUrl({})).toBeUndefined();
  });
});
