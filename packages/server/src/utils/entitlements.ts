import { config } from '../config';

export type Plan = 'free' | 'pro';
export type SubscriptionSource = 'paddle' | 'developer' | 'gift' | 'trial';

export type ProEntitlementInput = {
  email?: string | null;
  plan?: string | null;
  subscriptionSource?: string | null;
  expiresAt?: Date | string | null;
  purchaseType?: string | null;
  paddleCustomerId?: string | null;
  paddleSubscriptionId?: string | null;
};

export type ProEntitlement = {
  plan: Plan;
  isPro: boolean;
  subscriptionSource: SubscriptionSource | null;
  expiresAt: Date | null;
};

const PRO_SOURCES = new Set<SubscriptionSource>(['paddle', 'developer', 'gift', 'trial']);

function normalizeEmail(email?: string | null): string {
  return email?.trim().toLowerCase() || '';
}

function normalizeSource(source?: string | null): SubscriptionSource | null {
  if (!source) return null;
  return PRO_SOURCES.has(source as SubscriptionSource) ? (source as SubscriptionSource) : null;
}

function normalizeExpiresAt(value?: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDeveloperEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && config.developerEmails.includes(normalized);
}

function inferLegacySource(user: ProEntitlementInput): SubscriptionSource | null {
  if (user.subscriptionSource) return normalizeSource(user.subscriptionSource);
  if (user.plan !== 'pro') return null;
  if (user.paddleCustomerId || user.paddleSubscriptionId || user.purchaseType) return 'paddle';
  return 'paddle';
}

function isFutureOrNow(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() >= now.getTime();
}

export function resolveProEntitlement(
  user: ProEntitlementInput | null | undefined,
  now = new Date()
): ProEntitlement {
  if (config.selfHosted) {
    return {
      plan: 'pro',
      isPro: true,
      subscriptionSource: null,
      expiresAt: null,
    };
  }

  if (!user) {
    return {
      plan: 'free',
      isPro: false,
      subscriptionSource: null,
      expiresAt: null,
    };
  }

  if (isDeveloperEmail(user.email)) {
    return {
      plan: 'pro',
      isPro: true,
      subscriptionSource: 'developer',
      expiresAt: null,
    };
  }

  const source = inferLegacySource(user);
  const expiresAt = normalizeExpiresAt(user.expiresAt);
  const hasProPlan = user.plan === 'pro';

  if (!hasProPlan || !source) {
    return {
      plan: 'free',
      isPro: false,
      subscriptionSource: null,
      expiresAt,
    };
  }

  if (source === 'paddle') {
    return {
      plan: 'pro',
      isPro: true,
      subscriptionSource: source,
      expiresAt: null,
    };
  }

  if (source === 'developer') {
    const isPro = isFutureOrNow(expiresAt, now);
    return {
      plan: isPro ? 'pro' : 'free',
      isPro,
      subscriptionSource: isPro ? source : null,
      expiresAt,
    };
  }

  const isPro = !!expiresAt && expiresAt.getTime() >= now.getTime();
  return {
    plan: isPro ? 'pro' : 'free',
    isPro,
    subscriptionSource: isPro ? source : null,
    expiresAt,
  };
}

export function hasProAccess(
  user: ProEntitlementInput | null | undefined,
  now = new Date()
): boolean {
  return resolveProEntitlement(user, now).isPro;
}
