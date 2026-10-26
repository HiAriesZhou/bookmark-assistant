import { describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_DEFAULT_MODELS,
  AiProviderGenerationError,
  AiProviderValidationError,
  aiEndpointHost,
  createAiProviderAdapter,
  officialProviderForBaseUrl,
  type FetchLike,
} from './ai-provider-adapters';

function successfulFetch(): FetchLike {
  return vi.fn(async () => new Response('{}', { status: 200 }));
}

describe('AI provider adapters', () => {
  it.each(['openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'minimax'] as const)(
    'validates a %s key with a small provider-specific model call',
    async (provider) => {
      const fetcher = successfulFetch();
      const adapter = createAiProviderAdapter(provider, fetcher);

      await expect(adapter.validateApiKey('test-key')).resolves.toBeUndefined();
      expect(adapter.model).toBe(AI_PROVIDER_DEFAULT_MODELS[provider]);
      const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
      expect(String(url)).not.toContain('test-key');
      expect(init?.method).toBe('POST');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.body).toContain('Reply with OK.');
      expect(`${url}${init?.body}`).toContain(AI_PROVIDER_DEFAULT_MODELS[provider]);
    }
  );

  it('uses the documented authorization headers for each provider', async () => {
    const testCases = [
      ['openai', 'authorization'] as const,
      ['anthropic', 'x-api-key'] as const,
      ['gemini', 'x-goog-api-key'] as const,
      ['deepseek', 'authorization'] as const,
      ['groq', 'authorization'] as const,
      ['minimax', 'x-api-key'] as const,
    ];

    for (const [provider, header] of testCases) {
      const fetcher = successfulFetch();
      await createAiProviderAdapter(provider, fetcher).validateApiKey('test-key');
      const headers = vi.mocked(fetcher).mock.calls[0]![1]?.headers as Record<string, string>;
      expect(headers[header]).toContain('test-key');
    }
  });

  it('does not silently fall back when validation fails', async () => {
    const fetcher: FetchLike = vi.fn(async () => new Response('{}', { status: 401 }));
    const adapter = createAiProviderAdapter('openai', fetcher);

    await expect(adapter.validateApiKey('bad-key')).rejects.toMatchObject<
      Partial<AiProviderValidationError>
    >({
      code: 'invalid_api_key',
      provider: 'openai',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['openai', 'https://llm.example.com/v1/responses'],
    ['anthropic', 'https://llm.example.com/v1/messages'],
    ['gemini', 'https://llm.example.com/v1/models/gemini-2.5-flash:generateContent'],
    ['deepseek', 'https://llm.example.com/v1/chat/completions'],
    ['groq', 'https://llm.example.com/v1/chat/completions'],
    ['minimax', 'https://llm.example.com/v1/messages'],
  ] as const)('sends %s requests to a custom base URL', async (provider, expectedUrl) => {
    const fetcher = successfulFetch();
    const adapter = createAiProviderAdapter(
      provider,
      fetcher,
      AI_PROVIDER_DEFAULT_MODELS[provider],
      'https://llm.example.com/v1'
    );

    await adapter.validateApiKey('test-key');
    await adapter.generate('test-key', 'prompt').catch(() => undefined);
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([expectedUrl, expectedUrl]);
  });

  it('classifies a Gemini-style invalid key response as a rejected key', async () => {
    const fetcher: FetchLike = vi.fn(
      async () =>
        new Response('{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid."}}', {
          status: 400,
        })
    );
    await expect(
      createAiProviderAdapter('gemini', fetcher).validateApiKey('bad-key')
    ).rejects.toMatchObject({ code: 'invalid_api_key', provider: 'gemini' });
  });

  it('maps official hosts to providers and reports the endpoint host', () => {
    expect(officialProviderForBaseUrl('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(officialProviderForBaseUrl('https://api.groq.com')).toBe('groq');
    expect(officialProviderForBaseUrl('https://llm.example.com/v1')).toBeUndefined();
    expect(aiEndpointHost('deepseek')).toBe('api.deepseek.com');
    expect(aiEndpointHost('gemini')).toBe('generativelanguage.googleapis.com');
    expect(aiEndpointHost('openai', 'http://localhost:4000/v1')).toBe('localhost:4000');
  });

  it('classifies provider network and timeout failures as unavailable', async () => {
    const fetcher: FetchLike = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    await expect(
      createAiProviderAdapter('openai', fetcher).validateApiKey('test-key')
    ).rejects.toMatchObject({
      code: 'service_unavailable',
      provider: 'openai',
    });
  });

  it.each([
    [
      'openai',
      {
        id: 'resp-1',
        output: [{ content: [{ type: 'output_text', text: '{"summary":"x","tags":["a"]}' }] }],
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    ],
    [
      'anthropic',
      {
        id: 'msg-1',
        content: [{ type: 'text', text: '{"summary":"x","tags":["a"]}' }],
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    ],
    [
      'gemini',
      {
        responseId: 'gem-1',
        candidates: [{ content: { parts: [{ text: '{"summary":"x","tags":["a"]}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
      },
    ],
    [
      'deepseek',
      {
        id: 'deepseek-1',
        choices: [{ message: { content: '{"summary":"x","tags":["a"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      },
    ],
    [
      'groq',
      {
        id: 'groq-1',
        choices: [{ message: { content: '{"summary":"x","tags":["a"]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      },
    ],
    [
      'minimax',
      {
        id: 'minimax-1',
        content: [{ type: 'text', text: '{"summary":"x","tags":["a"]}' }],
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    ],
  ] as const)('extracts generated text and usage from %s responses', async (provider, payload) => {
    const fetcher: FetchLike = vi.fn(
      async () => new Response(JSON.stringify(payload), { status: 200 })
    );
    const result = await createAiProviderAdapter(provider, fetcher).generate(
      'test-key',
      'generate this'
    );

    expect(result.text).toContain('summary');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(8);
    const [, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(init?.body).toContain('generate this');
  });

  it('classifies a rejected generation key as needing user action', async () => {
    const fetcher: FetchLike = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(
      createAiProviderAdapter('openai', fetcher).generate('bad-key', 'content')
    ).rejects.toMatchObject<Partial<AiProviderGenerationError>>({
      code: 'invalid_api_key',
      provider: 'openai',
    });
  });

  it('distinguishes exhausted quota from transient rate limiting', async () => {
    const quotaFetcher: FetchLike = vi.fn(
      async () =>
        new Response('{"error":"insufficient_quota: add billing credits"}', { status: 429 })
    );
    await expect(
      createAiProviderAdapter('openai', quotaFetcher).generate('key', 'content')
    ).rejects.toMatchObject({ code: 'insufficient_quota' });

    const rateFetcher: FetchLike = vi.fn(
      async () =>
        new Response('{"error":"too many requests"}', {
          status: 429,
          headers: { 'retry-after': '7' },
        })
    );
    await expect(
      createAiProviderAdapter('openai', rateFetcher).generate('key', 'content')
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 7_000 });
  });
});
