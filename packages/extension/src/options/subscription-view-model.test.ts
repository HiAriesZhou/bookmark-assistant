import { describe, expect, it } from 'vitest';
import { deriveSubscriptionViewModel, getSubscriptionAction } from './subscription-view-model';

describe('subscription view model', () => {
  it('prioritizes free over stale subscription metadata', () => {
    expect(
      deriveSubscriptionViewModel({
        plan: 'free',
        isPro: false,
        subscriptionSource: 'paddle',
        purchaseType: 'monthly',
      }).kind
    ).toBe('free');
  });

  it.each([
    ['paddle', 'monthly', 'paddle-monthly'],
    ['paddle', 'yearly', 'paddle-yearly'],
    ['developer', undefined, 'developer'],
    ['gift', undefined, 'gift'],
    ['trial', undefined, 'trial'],
  ] as const)('maps %s / %s to %s', (subscriptionSource, purchaseType, expected) => {
    expect(
      deriveSubscriptionViewModel({
        plan: 'pro',
        isPro: true,
        subscriptionSource,
        purchaseType,
      }).kind
    ).toBe(expected);
  });

  it('keeps incomplete Pro metadata explicit', () => {
    expect(deriveSubscriptionViewModel({ plan: 'pro', isPro: true }).kind).toBe('pro-unclassified');
  });

  it('exposes the portal for recurring Paddle subscriptions', () => {
    expect(getSubscriptionAction('paddle-monthly')).toBe('manage-portal');
    expect(getSubscriptionAction('paddle-yearly')).toBe('manage-portal');
  });
});
