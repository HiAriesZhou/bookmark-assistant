import type { DeploymentProfile, SignInMethod } from '@bookmark-assistant/types';
import type { UserProfile } from '../background/server-api';

/** One server profile supplies both account views and the background-owned cache. */
export function mapAccountProfile(profile: UserProfile, apiOrigin: string) {
  const isPro = profile.isPro === true;
  const deploymentMode = profile.deploymentMode === 'self-hosted' ? 'self-hosted' : 'hosted';
  const signInMethods: SignInMethod[] = Array.isArray(profile.signInMethods)
    ? [...profile.signInMethods]
    : [];
  const deployment: DeploymentProfile = {
    deploymentMode,
    commerceEnabled: deploymentMode === 'hosted' && (profile.commerceEnabled ?? true),
    capabilities: profile.capabilities || { autoSync: isPro, batchAi: isPro },
    signInMethods,
  };
  const subscriptionExpiresAt = profile.expiresAt ?? null;
  return {
    state: {
      ...deployment,
      isPro,
      plan: profile.plan === 'pro' ? ('pro' as const) : ('free' as const),
      purchaseType: profile.purchaseType,
      subscriptionSource: profile.subscriptionSource,
      subscriptionExpiresAt,
    },
    cache: {
      deployment_profile: { ...deployment, apiOrigin },
      is_pro: isPro,
      purchase_type: profile.purchaseType,
      subscription_source: profile.subscriptionSource,
      subscription_expires_at: subscriptionExpiresAt,
      entitlements_cached_at: Date.now(),
    },
  };
}
