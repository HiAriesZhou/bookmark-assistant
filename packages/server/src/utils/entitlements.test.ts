/**
 * Unit tests for server-side Pro entitlement resolution.
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  selfHosted: false,
  developerEmails: [] as string[],
}));

vi.mock('../config', () => ({
  config: mockConfig,
}));

import { hasProAccess, resolveProEntitlement } from './entitlements';

const now = new Date('2026-07-08T00:00:00.000Z');

describe('Pro entitlements', () => {
  beforeEach(() => {
    mockConfig.selfHosted = false;
    mockConfig.developerEmails = [];
  });

  it('does not grant Pro to a free user', () => {
    const entitlement = resolveProEntitlement({ email: 'free@example.com', plan: 'free' }, now);

    expect(entitlement).toMatchObject({
      plan: 'free',
      isPro: false,
      subscriptionSource: null,
    });
    expect(hasProAccess({ plan: 'free' }, now)).toBe(false);
  });

  it('grants self-hosted features without pretending to be a developer subscription', () => {
    mockConfig.selfHosted = true;
    expect(resolveProEntitlement({ plan: 'free' }, now)).toEqual({
      plan: 'pro',
      isPro: true,
      subscriptionSource: null,
      expiresAt: null,
    });
  });

  it('ignores a client-provided deployment flag in hosted mode', () => {
    expect(hasProAccess({ plan: 'free', selfHosted: true } as never, now)).toBe(false);
  });

  it('grants Pro to a Paddle paid user', () => {
    const entitlement = resolveProEntitlement(
      {
        email: 'paid@example.com',
        plan: 'pro',
        subscriptionSource: 'paddle',
        paddleSubscriptionId: 'sub_123',
      },
      now
    );

    expect(entitlement).toMatchObject({
      plan: 'pro',
      isPro: true,
      subscriptionSource: 'paddle',
    });
  });

  it('grants Pro to a developer email from DEVELOPER_EMAILS', () => {
    mockConfig.developerEmails = ['dev@example.com'];

    const entitlement = resolveProEntitlement({ email: ' Dev@Example.com ', plan: 'free' }, now);

    expect(entitlement).toMatchObject({
      plan: 'pro',
      isPro: true,
      subscriptionSource: 'developer',
      expiresAt: null,
    });
  });

  it('grants developer Pro when expiresAt is null', () => {
    expect(
      hasProAccess({ plan: 'pro', subscriptionSource: 'developer', expiresAt: null }, now)
    ).toBe(true);
  });

  it('does not grant expired trial or gift access', () => {
    const expired = '2026-07-07T23:59:59.000Z';

    expect(
      hasProAccess({ plan: 'pro', subscriptionSource: 'trial', expiresAt: expired }, now)
    ).toBe(false);
    expect(hasProAccess({ plan: 'pro', subscriptionSource: 'gift', expiresAt: expired }, now)).toBe(
      false
    );
  });

  it('grants unexpired trial or gift access', () => {
    const future = '2026-07-09T00:00:00.000Z';

    expect(hasProAccess({ plan: 'pro', subscriptionSource: 'trial', expiresAt: future }, now)).toBe(
      true
    );
    expect(hasProAccess({ plan: 'pro', subscriptionSource: 'gift', expiresAt: future }, now)).toBe(
      true
    );
  });

  it('keeps legacy Pro records valid as Paddle access', () => {
    const entitlement = resolveProEntitlement({ plan: 'pro', purchaseType: 'monthly' }, now);

    expect(entitlement).toMatchObject({
      plan: 'pro',
      isPro: true,
      subscriptionSource: 'paddle',
    });
  });
});
