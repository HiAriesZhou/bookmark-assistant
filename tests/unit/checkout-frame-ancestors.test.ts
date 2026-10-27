import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_EXTENSION_ID,
  checkoutFrameAncestors,
  // @ts-expect-error The website config helper is plain ESM.
} from '../../packages/website/lib/checkout-frame-ancestors.mjs';

describe('checkout frame-ancestors', () => {
  it('lets the official site be framed only by itself and the store extension', () => {
    expect(checkoutFrameAncestors({ officialService: true })).toBe(
      `frame-ancestors 'self' chrome-extension://${OFFICIAL_EXTENSION_ID}`
    );
  });

  it('adds valid extra extension IDs and ignores anything else', () => {
    const extra = 'lbiegcilhogmbnooimljleklifbpmenc';
    expect(
      checkoutFrameAncestors({
        officialService: true,
        extensionIds: `${extra}, https://evil.example, ${OFFICIAL_EXTENSION_ID}`,
      })
    ).toBe(
      `frame-ancestors 'self' chrome-extension://${OFFICIAL_EXTENSION_ID} chrome-extension://${extra}`
    );
  });

  it('allows only the site itself for other deployments without configured IDs', () => {
    expect(checkoutFrameAncestors({ officialService: false })).toBe("frame-ancestors 'self'");
  });
});
