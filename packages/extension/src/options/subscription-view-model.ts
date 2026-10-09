import type { SubscriptionSource } from './store';

export type SubscriptionKind =
  | 'loading'
  | 'free'
  | 'paddle-monthly'
  | 'paddle-yearly'
  | 'developer'
  | 'gift'
  | 'trial'
  | 'pro-unclassified';

export type SubscriptionViewModel = {
  kind: SubscriptionKind;
  email?: string;
  expirationDate?: string;
};

export type SubscriptionAction = 'none' | 'view-plans' | 'upgrade' | 'manage-portal';

export function deriveSubscriptionViewModel(input: {
  isLoading?: boolean;
  plan: 'free' | 'pro';
  isPro: boolean;
  subscriptionSource?: SubscriptionSource | null;
  purchaseType?: 'monthly' | 'yearly';
  subscriptionExpiresAt?: string | null;
  userEmail?: string;
}): SubscriptionViewModel {
  if (input.isLoading) return { kind: 'loading', email: input.userEmail || undefined };

  const base = {
    email: input.userEmail || undefined,
    expirationDate: input.subscriptionExpiresAt || undefined,
  };

  // Free must win over incomplete or stale source fields.
  if (input.plan === 'free' || !input.isPro) return { kind: 'free', ...base };

  if (input.subscriptionSource === 'paddle' && input.purchaseType === 'monthly') {
    return { kind: 'paddle-monthly', ...base };
  }
  if (input.subscriptionSource === 'paddle' && input.purchaseType === 'yearly') {
    return { kind: 'paddle-yearly', ...base };
  }
  if (input.subscriptionSource === 'developer') return { kind: 'developer', ...base };
  if (input.subscriptionSource === 'gift') return { kind: 'gift', ...base };
  if (input.subscriptionSource === 'trial') return { kind: 'trial', ...base };

  return { kind: 'pro-unclassified', ...base };
}

export function getSubscriptionAction(kind: SubscriptionKind): SubscriptionAction {
  if (kind === 'paddle-monthly' || kind === 'paddle-yearly') return 'manage-portal';
  if (kind === 'trial') return 'upgrade';
  if (kind === 'free') return 'view-plans';
  return 'none';
}
