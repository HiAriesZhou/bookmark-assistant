import { describe, expect, it } from 'vitest';
import { canSendCurrentPageToAi, type CurrentPageAiSettings } from './ai-page-policy';

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
});

function configuredSettings(overrides: Partial<CurrentPageAiSettings> = {}): CurrentPageAiSettings {
  return {
    singlePageEnabled: true,
    properties: { descriptionPropertyId: 'description', tagsPropertyId: 'tags' },
    ...overrides,
  };
}
