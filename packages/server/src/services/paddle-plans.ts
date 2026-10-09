export type RecurringPurchaseType = 'monthly' | 'yearly';

export function isRecurringPurchaseType(value: unknown): value is RecurringPurchaseType {
  return value === 'monthly' || value === 'yearly';
}

export function resolveRecurringPurchaseType(
  input: {
    itemPriceIds?: string[];
    checkoutPricing?: unknown;
  },
  priceIds: { monthly: string; yearly: string }
): RecurringPurchaseType | undefined {
  if (priceIds.yearly && input.itemPriceIds?.includes(priceIds.yearly)) return 'yearly';
  if (priceIds.monthly && input.itemPriceIds?.includes(priceIds.monthly)) return 'monthly';
  return isRecurringPurchaseType(input.checkoutPricing) ? input.checkoutPricing : undefined;
}
