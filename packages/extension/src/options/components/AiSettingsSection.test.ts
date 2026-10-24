import { describe, expect, it } from 'vitest';
import { aiCredentialIdentityLine } from './ai-settings-provider';

describe('AI credential identity', () => {
  it('shows the detected provider with its endpoint host', () => {
    expect(
      aiCredentialIdentityLine({
        provider: 'deepseek',
        host: 'api.deepseek.com',
        keyLastFour: '1234',
        status: 'verified',
      })
    ).toBe('DeepSeek · api.deepseek.com');
  });

  it('falls back to the provider name when an older server omits the host', () => {
    expect(
      aiCredentialIdentityLine({ provider: 'openai', keyLastFour: '1234', status: 'verified' })
    ).toBe('OpenAI');
  });
});
