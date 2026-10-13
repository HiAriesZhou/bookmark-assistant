import type { DeploymentProfile } from '@bookmark-assistant/types';
import type { UserProfile } from '../background/server-api';

/** Account views and OAuth cache writes retain their existing boundary defaults. */
export function mapAccountProfile(profile: UserProfile, apiOrigin: string, oauthIsPro?: boolean) {
  const forOptions = oauthIsPro === undefined;
  const isPro = oauthIsPro ?? profile.isPro === true;
  const deploymentMode = forOptions
    ? profile.deploymentMode === 'self-hosted'
      ? 'self-hosted'
      : 'hosted'
    : profile.deploymentMode || 'hosted';
  const deployment: DeploymentProfile = {
    deploymentMode,
    commerceEnabled:
      (!forOptions || deploymentMode === 'hosted') && (profile.commerceEnabled ?? true),
    capabilities: profile.capabilities || { autoSync: isPro, batchAi: isPro },
  };
  const subscriptionExpiresAt = forOptions ? (profile.expiresAt ?? null) : profile.expiresAt;
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
