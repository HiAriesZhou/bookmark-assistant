import { describe, expect, it } from 'vitest';
import { providerChangeRequiresNewKey } from './ai-settings-provider';

describe('AI settings provider replacement', () => {
  it('requires a new key before changing away from the saved provider', () => {
    expect(providerChangeRequiresNewKey('openai', 'deepseek', '')).toBe(true);
    expect(providerChangeRequiresNewKey('openai', 'deepseek', '  new-key  ')).toBe(false);
    expect(providerChangeRequiresNewKey('openai', 'openai', '')).toBe(false);
    expect(providerChangeRequiresNewKey(undefined, 'openai', '')).toBe(false);
  });
});
