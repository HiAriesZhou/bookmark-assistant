import type { AiProvider } from '@bookmark-assistant/types';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_DEFAULT_MODELS,
  AiProviderValidationError,
  type AiProviderAdapter,
  type AiProviderValidationErrorCode,
} from './ai-provider-adapters';
import {
  AiProviderDetectionError,
  AiProviderPausedError,
  candidateProvidersForKey,
  detectAiProvider,
} from './ai-provider-detection';

type Outcome = 'ok' | AiProviderValidationErrorCode;

// Synthetic, low-entropy fixture shaped like a DeepSeek key.
const DEEPSEEK_SHAPED_KEY = `sk-${'0'.repeat(32)}`;

function fakeProviders(outcomes: Partial<Record<AiProvider, Outcome>>, paused: AiProvider[] = []) {
  const probes: Array<{ provider: AiProvider; baseUrl?: string }> = [];
  const adapterFor = vi.fn((provider: AiProvider, baseUrl?: string): AiProviderAdapter => {
    return {
      provider,
      model: AI_PROVIDER_DEFAULT_MODELS[provider],
      async validateApiKey() {
        probes.push({ provider, baseUrl });
        const outcome = outcomes[provider] ?? 'invalid_api_key';
        if (outcome !== 'ok') throw new AiProviderValidationError(outcome, provider);
      },
      async generate() {
        throw new Error('not used');
      },
    };
  });
  const isAllowed = vi.fn(async (provider: AiProvider) => !paused.includes(provider));
  return { probes, deps: { adapterFor, isAllowed } };
}

describe('candidateProvidersForKey', () => {
  it.each([
    ['sk-ant-test', ['anthropic']],
    ['AIzaSyExample', ['gemini']],
    ['gsk_example', ['groq']],
    ['sk-proj-example', ['openai']],
    ['sk-svcacct-example', ['openai']],
    [DEEPSEEK_SHAPED_KEY, ['deepseek', 'openai', 'minimax']],
    ['sk-SomeLegacyStyleKeyValue', ['openai', 'deepseek', 'minimax']],
    ['eyJhbGciOiJSUzI1NiJ9.payload.signature', ['minimax', 'openai', 'deepseek']],
    ['unrecognized-key-shape', ['openai', 'deepseek', 'minimax']],
  ] as const)('orders candidates for %s', (apiKey, expected) => {
    expect(candidateProvidersForKey(apiKey)).toEqual(expected);
  });

  it('never sends keys without a strong prefix to strong-prefix providers', () => {
    for (const key of ['sk-abc', 'eyJabc', 'plain-key']) {
      expect(candidateProvidersForKey(key)).not.toContain('anthropic');
      expect(candidateProvidersForKey(key)).not.toContain('gemini');
      expect(candidateProvidersForKey(key)).not.toContain('groq');
    }
  });
});

describe('detectAiProvider', () => {
  it('returns the provider that accepts the key with its default model', async () => {
    const { deps, probes } = fakeProviders({ deepseek: 'ok' });

    await expect(detectAiProvider({ apiKey: DEEPSEEK_SHAPED_KEY }, deps)).resolves.toEqual({
      provider: 'deepseek',
      model: AI_PROVIDER_DEFAULT_MODELS.deepseek,
      baseUrl: null,
    });
    expect(probes.map((probe) => probe.provider).sort()).toEqual(['deepseek', 'minimax', 'openai']);
    expect(probes.every((probe) => probe.baseUrl === undefined)).toBe(true);
  });

  it('probes only the matching provider for a strong key prefix', async () => {
    const { deps, probes } = fakeProviders({ anthropic: 'ok' });

    await expect(detectAiProvider({ apiKey: 'sk-ant-test' }, deps)).resolves.toMatchObject({
      provider: 'anthropic',
    });
    expect(probes).toEqual([{ provider: 'anthropic', baseUrl: undefined }]);
  });

  it('prefers the earlier candidate when more than one provider accepts', async () => {
    const { deps } = fakeProviders({ openai: 'ok', deepseek: 'ok' });
    await expect(detectAiProvider({ apiKey: 'sk-generic-key' }, deps)).resolves.toMatchObject({
      provider: 'openai',
    });
  });

  it('reports a recognized key that cannot be used instead of saving it', async () => {
    const { deps } = fakeProviders({ deepseek: 'insufficient_quota' });

    await expect(detectAiProvider({ apiKey: 'sk-generic-key' }, deps)).rejects.toMatchObject({
      name: 'AiProviderValidationError',
      code: 'insufficient_quota',
      provider: 'deepseek',
    });
  });

  it('returns a recoverable error when no provider accepts the key', async () => {
    const { deps } = fakeProviders({});

    const error = await detectAiProvider({ apiKey: 'sk-generic-key' }, deps).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderDetectionError);
    expect(error.code).toBe('provider_not_detected');
  });

  it('does not claim detection failed while an official candidate is unavailable', async () => {
    const { deps } = fakeProviders({ deepseek: 'service_unavailable' });

    await expect(detectAiProvider({ apiKey: 'sk-generic-key' }, deps)).rejects.toMatchObject({
      name: 'AiProviderValidationError',
      code: 'service_unavailable',
      provider: 'deepseek',
    });
  });

  it('skips paused providers and reports a pause when every candidate is paused', async () => {
    const partial = fakeProviders({ deepseek: 'ok', openai: 'ok' }, ['openai']);
    await expect(
      detectAiProvider({ apiKey: 'sk-generic-key' }, partial.deps)
    ).resolves.toMatchObject({ provider: 'deepseek' });
    expect(partial.probes.map((probe) => probe.provider)).not.toContain('openai');

    const all = fakeProviders({ anthropic: 'ok' }, ['anthropic']);
    await expect(detectAiProvider({ apiKey: 'sk-ant-test' }, all.deps)).rejects.toBeInstanceOf(
      AiProviderPausedError
    );
    expect(all.probes).toEqual([]);
  });

  it('keeps the explicit provider path for older clients', async () => {
    const { deps, probes } = fakeProviders({ gemini: 'ok' });

    await expect(
      detectAiProvider({ apiKey: 'unusual-key', provider: 'gemini' }, deps)
    ).resolves.toMatchObject({ provider: 'gemini', baseUrl: null });
    expect(probes).toEqual([{ provider: 'gemini', baseUrl: undefined }]);
  });

  it('treats an official provider host as a provider hint without storing a custom endpoint', async () => {
    const { deps, probes } = fakeProviders({ anthropic: 'ok' });

    await expect(
      detectAiProvider({ apiKey: 'new-style-key', baseUrl: 'https://api.anthropic.com' }, deps)
    ).resolves.toEqual({
      provider: 'anthropic',
      model: AI_PROVIDER_DEFAULT_MODELS.anthropic,
      baseUrl: null,
    });
    expect(probes).toEqual([{ provider: 'anthropic', baseUrl: undefined }]);
  });

  it('probes every supported protocol against a custom endpoint and keeps it', async () => {
    const { deps, probes } = fakeProviders({ anthropic: 'ok' });

    await expect(
      detectAiProvider({ apiKey: 'gateway-key', baseUrl: 'https://llm.example.com/v1' }, deps)
    ).resolves.toEqual({
      provider: 'anthropic',
      model: AI_PROVIDER_DEFAULT_MODELS.anthropic,
      baseUrl: 'https://llm.example.com/v1',
    });
    expect(probes).toHaveLength(6);
    expect(probes.every((probe) => probe.baseUrl === 'https://llm.example.com/v1')).toBe(true);
  });

  it('does not treat a missing route on a custom endpoint as a recognized key', async () => {
    const { deps } = fakeProviders({ openai: 'model_access', deepseek: 'service_unavailable' });

    await expect(
      detectAiProvider({ apiKey: 'gateway-key', baseUrl: 'https://llm.example.com/v1' }, deps)
    ).rejects.toBeInstanceOf(AiProviderDetectionError);
  });
});
