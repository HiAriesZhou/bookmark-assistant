import { describe, expect, it } from 'vitest';
import { isRecurringPurchaseType, resolveRecurringPurchaseType } from './paddle-plans';

describe('Paddle recurring plans', () => {
  const priceIds = { monthly: 'pri_monthly', yearly: 'pri_yearly' };

  it('only accepts plans that are currently available for checkout', () => {
    expect(isRecurringPurchaseType('monthly')).toBe(true);
    expect(isRecurringPurchaseType('yearly')).toBe(true);
    expect(isRecurringPurchaseType('lifetime')).toBe(false);
  });

  it('uses subscription item price IDs before checkout metadata', () => {
    expect(
      resolveRecurringPurchaseType(
        { itemPriceIds: ['pri_yearly'], checkoutPricing: 'monthly' },
        priceIds
      )
    ).toBe('yearly');
    expect(resolveRecurringPurchaseType({ checkoutPricing: 'yearly' }, priceIds)).toBe('yearly');
  });
});
