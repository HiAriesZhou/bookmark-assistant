import { describe, expect, it } from 'vitest';
import type { UserProfile } from '../background/server-api';
import { mapAccountProfile } from './account-profile';

const profile: UserProfile = {
  userId: 'account',
  isPro: true,
  plan: 'pro',
  subscriptionSource: null,
  expiresAt: null,
};

describe('account profile mapping', () => {
  it('keeps server capabilities and suppresses commerce in the self-hosted account view', () => {
    const mapped = mapAccountProfile(
      {
        ...profile,
        deploymentMode: 'self-hosted',
        commerceEnabled: true,
        capabilities: { autoSync: false, batchAi: true },
      },
      'https://self.example'
    );

    expect(mapped.state).toMatchObject({
      deploymentMode: 'self-hosted',
      commerceEnabled: false,
      capabilities: { autoSync: false, batchAi: true },
      isPro: true,
      plan: 'pro',
      subscriptionExpiresAt: null,
    });
    expect(mapped.cache.deployment_profile).toMatchObject({
      commerceEnabled: false,
      apiOrigin: 'https://self.example',
    });
  });

  it('retains hosted fallback capabilities', () => {
    expect(mapAccountProfile(profile, 'https://hosted.example').state).toMatchObject({
      deploymentMode: 'hosted',
      commerceEnabled: true,
      capabilities: { autoSync: true, batchAi: true },
    });
  });
});
