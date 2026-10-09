import { describe, expect, it } from 'vitest';
import { isAiSourceDisallowed, isSinglePageAiConfigured } from './ai-settings-service';

describe('isAiSourceDisallowed', () => {
  it('rejects local, private, credentialed, and non-http sources', () => {
    expect(isAiSourceDisallowed('http://localhost:3000')).toBe(true);
    expect(isAiSourceDisallowed('http://10.0.0.2')).toBe(true);
    expect(isAiSourceDisallowed('http://wiki.internal')).toBe(true);
    expect(isAiSourceDisallowed('https://user:pass@example.com')).toBe(true);
    expect(isAiSourceDisallowed('file:///tmp/private.html')).toBe(true);
    expect(isAiSourceDisallowed('https://example.com/a')).toBe(false);
  });
});

describe('isSinglePageAiConfigured', () => {
  it('uses the configured Notion mapping instead of the retired user preference', () => {
    expect(
      isSinglePageAiConfigured({
        singlePageEnabled: false,
        batchEnabled: false,
        properties: { descriptionPropertyId: 'description', tagsPropertyId: 'tags' },
      })
    ).toBe(true);
    expect(
      isSinglePageAiConfigured({
        singlePageEnabled: true,
        batchEnabled: false,
      })
    ).toBe(false);
  });
});
