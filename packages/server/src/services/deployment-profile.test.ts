/**
 * Sign-in methods advertised by a deployment.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { resolveSignInMethods } from './deployment-profile';

describe('resolveSignInMethods', () => {
  it('keeps Notion and adds email or Google only when that deployment can use them', () => {
    expect(
      resolveSignInMethods({ selfHosted: false, resendConfigured: false, googleConfigured: false })
    ).toEqual(['notion']);
    expect(
      resolveSignInMethods({ selfHosted: false, resendConfigured: true, googleConfigured: false })
    ).toEqual(['email', 'notion']);
    expect(
      resolveSignInMethods({ selfHosted: true, resendConfigured: false, googleConfigured: false })
    ).toEqual(['email', 'notion']);
    expect(
      resolveSignInMethods({ selfHosted: false, resendConfigured: false, googleConfigured: true })
    ).toEqual(['google', 'notion']);
    expect(
      resolveSignInMethods({ selfHosted: true, resendConfigured: true, googleConfigured: true })
    ).toEqual(['email', 'google', 'notion']);
  });
});
