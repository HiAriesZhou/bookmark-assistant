import type { DeploymentProfile, SignInMethod } from '@bookmark-assistant/types';
import { config } from '../config';

export function resolveSignInMethods(input: {
  selfHosted: boolean;
  resendConfigured: boolean;
  googleConfigured: boolean;
}): SignInMethod[] {
  const methods: SignInMethod[] = [];
  if (input.resendConfigured || input.selfHosted) methods.push('email');
  if (input.googleConfigured) methods.push('google');
  methods.push('notion');
  return methods;
}

export function currentSignInMethods(): SignInMethod[] {
  return resolveSignInMethods({
    selfHosted: config.selfHosted,
    resendConfigured: !!config.resendApiKey,
    googleConfigured: !!config.googleClientId && !!config.googleClientSecret,
  });
}

/** Unsigned clients learn which sign-in buttons to show. Capabilities here are the deployment ceiling. */
export function publicDeploymentProfile(): DeploymentProfile {
  const selfHosted = config.selfHosted;
  return {
    deploymentMode: selfHosted ? 'self-hosted' : 'hosted',
    commerceEnabled: config.commerceEnabled,
    capabilities: { autoSync: selfHosted, batchAi: selfHosted },
    signInMethods: currentSignInMethods(),
  };
}
