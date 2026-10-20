import { describe, expect, it } from 'vitest';
import {
  canSendCurrentPageToAi,
  currentPageAiReadiness,
  type CurrentPageAiSettings,
} from './ai-page-policy';

describe('canSendCurrentPageToAi', () => {
  it('runs for configured users regardless of the legacy single-page preference', () => {
    expect(
      canSendCurrentPageToAi(
        'https://example.com',
        configuredSettings({ singlePageEnabled: false })
      )
    ).toBe(true);
    expect(canSendCurrentPageToAi('https://example.com', undefined)).toBe(false);
    expect(canSendCurrentPageToAi('https://example.com', { singlePageEnabled: true })).toBe(false);
  });

  it('never sends local or private-network pages', () => {
    const settings = configuredSettings();
    expect(canSendCurrentPageToAi('http://localhost:3000', settings)).toBe(false);
    expect(canSendCurrentPageToAi('http://192.168.1.2', settings)).toBe(false);
    expect(canSendCurrentPageToAi('http://wiki.internal', settings)).toBe(false);
    expect(canSendCurrentPageToAi('https://docs.example.com', settings)).toBe(true);
  });

  it('treats IPv6 literals as private without matching ordinary domain names', () => {
    const settings = configuredSettings();
    for (const url of [
      'https://fda.gov',
      'https://fdroid.org',
      'https://fcc.gov',
      'https://fe80.dev',
    ]) {
      expect(canSendCurrentPageToAi(url, settings)).toBe(true);
    }
    for (const url of ['http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/']) {
      expect(canSendCurrentPageToAi(url, settings)).toBe(false);
    }
  });
});

describe('currentPageAiReadiness', () => {
  const verified = { status: 'verified' };

  it('is ready only with a verified key, AI properties and a public page', () => {
    expect(currentPageAiReadiness('https://example.com', configuredSettings(), verified)).toBe(
      'ready'
    );
  });

  it('separates missing setup from a key that needs attention', () => {
    expect(currentPageAiReadiness('https://example.com', configuredSettings(), null)).toBe(
      'not_configured'
    );
    expect(currentPageAiReadiness('https://example.com', { properties: {} }, verified)).toBe(
      'not_configured'
    );
    expect(
      currentPageAiReadiness('https://example.com', configuredSettings(), { status: 'revoked' })
    ).toBe('needs_attention');
  });

  it('skips pages that must not be sent', () => {
    expect(currentPageAiReadiness('http://localhost:3000', configuredSettings(), verified)).toBe(
      'skipped_ineligible_page'
    );
  });
});

function configuredSettings(overrides: Partial<CurrentPageAiSettings> = {}): CurrentPageAiSettings {
  return {
    singlePageEnabled: true,
    properties: { descriptionPropertyId: 'description', tagsPropertyId: 'tags' },
    ...overrides,
  };
}
