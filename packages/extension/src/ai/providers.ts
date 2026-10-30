import type { AiProvider } from '@bookmark-assistant/types';

export const AI_PROVIDER_DEFAULT_MODELS: Readonly<Record<AiProvider, string>> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash',
  groq: 'openai/gpt-oss-20b',
  minimax: 'MiniMax-M2.7',
};

/**
 * Official API bases. A custom base URL replaces one of these and keeps the
 * provider's protocol, authorization header and default model.
 */
export const AI_PROVIDER_BASE_URLS: Readonly<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com',
  groq: 'https://api.groq.com/openai/v1',
  minimax: 'https://api.minimax.io/anthropic',
};

/** Returns the provider whose official API host matches, ignoring the path. */
export function officialProviderForBaseUrl(baseUrl: string): AiProvider | undefined {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return (Object.keys(AI_PROVIDER_BASE_URLS) as AiProvider[]).find(
    (provider) => new URL(AI_PROVIDER_BASE_URLS[provider]).hostname === hostname
  );
}

/** The host shown to users for a saved credential, including a custom port. */
export function aiEndpointHost(provider: AiProvider, baseUrl?: string | null): string {
  return new URL(baseUrl || AI_PROVIDER_BASE_URLS[provider]).host;
}

/** Match patterns for every endpoint an adapter calls, for extension host permissions. */
export const AI_PROVIDER_HOST_PERMISSIONS: Readonly<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/*',
  anthropic: 'https://api.anthropic.com/*',
  gemini: 'https://generativelanguage.googleapis.com/*',
  deepseek: 'https://api.deepseek.com/*',
  groq: 'https://api.groq.com/*',
  minimax: 'https://api.minimax.io/*',
};

export type AiProviderValidationErrorCode =
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'model_access'
  | 'service_unavailable';

export class AiProviderValidationError extends Error {
  readonly code: AiProviderValidationErrorCode;
  readonly provider: AiProvider;

  constructor(code: AiProviderValidationErrorCode, provider: AiProvider) {
    super(`Unable to validate ${provider} API key: ${code}.`);
    this.name = 'AiProviderValidationError';
    this.code = code;
    this.provider = provider;
  }
}

export type AiProviderGenerationErrorCode =
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'model_access'
  | 'rate_limited'
  | 'service_unavailable'
  | 'provider_request_failed'
  | 'invalid_provider_response';

export class AiProviderGenerationError extends Error {
  readonly code: AiProviderGenerationErrorCode;
  readonly provider: AiProvider;
  readonly retryAfterMs?: number;

  constructor(code: AiProviderGenerationErrorCode, provider: AiProvider, retryAfterMs?: number) {
    super(`AI generation failed for ${provider}: ${code}.`);
    this.name = 'AiProviderGenerationError';
    this.code = code;
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface AiProviderGenerationResult {
  text: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiProviderGenerationOptions {
  maxOutputTokens?: number;
  /**
   * Asks reasoning models to answer with minimal deliberation. Extension service
   * workers cannot wait much longer than 30 s for a response.
   */
  lowLatency?: boolean;
  /**
   * Asks for the most repeatable answer (temperature 0) where the provider accepts it.
   * OpenAI's reasoning models accept only their default, so OpenAI is unchanged.
   */
  deterministic?: boolean;
}

export interface AiProviderAdapter {
  readonly provider: AiProvider;
  readonly model: string;
  validateApiKey(apiKey: string): Promise<void>;
  generate(
    apiKey: string,
    prompt: string,
    options?: AiProviderGenerationOptions
  ): Promise<AiProviderGenerationResult>;
}

export interface AiProviderAdapterOptions {
  /** The extension calls providers directly; servers never set this. */
  browserClient?: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const AI_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 600;

/**
 * Makes a deliberately tiny, tool-free model call. A successful HTTP response is
 * sufficient for key validation; no response text is retained or logged.
 */
export function createAiProviderAdapter(
  provider: AiProvider,
  fetcher: FetchLike = fetch,
  model = AI_PROVIDER_DEFAULT_MODELS[provider],
  baseUrl: string = AI_PROVIDER_BASE_URLS[provider],
  { browserClient = false }: AiProviderAdapterOptions = {}
): AiProviderAdapter {
  const send = (request: [string, RequestInit]) =>
    fetcher(...withProviderTimeout(withBrowserAccess(provider, request, browserClient)));
  return {
    provider,
    model,
    async validateApiKey(apiKey: string): Promise<void> {
      let response: Response;
      try {
        response = await send(buildValidationRequest(provider, baseUrl, model, apiKey));
      } catch {
        throw new AiProviderValidationError('service_unavailable', provider);
      }
      if (!response.ok) {
        throw new AiProviderValidationError(await classifyFailure(response), provider);
      }
    },
    async generate(
      apiKey: string,
      prompt: string,
      {
        maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
        lowLatency = false,
        deterministic = false,
      }: AiProviderGenerationOptions = {}
    ): Promise<AiProviderGenerationResult> {
      let response: Response;
      try {
        response = await send(
          withDeterministic(
            provider,
            withLowLatency(
              provider,
              buildGenerationRequest(provider, baseUrl, model, apiKey, prompt, maxOutputTokens),
              lowLatency
            ),
            deterministic
          )
        );
      } catch {
        throw new AiProviderGenerationError('provider_request_failed', provider);
      }
      if (!response.ok) {
        const failure = await classifyGenerationFailure(response);
        throw new AiProviderGenerationError(failure.code, provider, failure.retryAfterMs);
      }
      try {
        return extractGenerationResult(provider, await response.json());
      } catch {
        throw new AiProviderGenerationError('invalid_provider_response', provider);
      }
    },
  };
}

function withProviderTimeout(request: [string, RequestInit]): [string, RequestInit] {
  return [
    request[0],
    { ...request[1], signal: AbortSignal.timeout(AI_PROVIDER_REQUEST_TIMEOUT_MS) },
  ];
}

/** Anthropic-style APIs reject browser-origin requests without an explicit opt-in. */
function withBrowserAccess(
  provider: AiProvider,
  request: [string, RequestInit],
  browserClient: boolean
): [string, RequestInit] {
  if (!browserClient || (provider !== 'anthropic' && provider !== 'minimax')) return request;
  return [
    request[0],
    {
      ...request[1],
      headers: {
        ...(request[1].headers as Record<string, string>),
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    },
  ];
}

function buildValidationRequest(
  provider: AiProvider,
  baseUrl: string,
  model: string,
  apiKey: string
): [string, RequestInit] {
  const common: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '',
  };

  switch (provider) {
    case 'openai':
      return [
        `${baseUrl}/responses`,
        {
          ...common,
          headers: { ...common.headers, authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            input: 'Reply with OK.',
            max_output_tokens: 16,
            store: false,
          }),
        },
      ];
    case 'anthropic':
      return [
        messagesUrl(baseUrl),
        {
          ...common,
          headers: {
            ...common.headers,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
          }),
        },
      ];
    case 'gemini':
      return [
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          ...common,
          headers: { ...common.headers, 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
            generationConfig: { maxOutputTokens: 16 },
          }),
        },
      ];
    case 'deepseek':
    case 'groq':
      return openAiCompatibleRequest(baseUrl, model, apiKey, 'Reply with OK.', 16);
    case 'minimax':
      return anthropicCompatibleRequest(baseUrl, model, apiKey, 'Reply with OK.', 16);
  }
}

function withDeterministic(
  provider: AiProvider,
  request: [string, RequestInit],
  deterministic: boolean
): [string, RequestInit] {
  if (!deterministic || provider === 'openai') return request;
  const body = JSON.parse(String(request[1].body)) as Record<string, any>;
  if (provider === 'gemini') body.generationConfig = { ...body.generationConfig, temperature: 0 };
  else body.temperature = 0;
  return [request[0], { ...request[1], body: JSON.stringify(body) }];
}

/** Only parameters documented for the default models; other providers are unchanged. */
function withLowLatency(
  provider: AiProvider,
  request: [string, RequestInit],
  lowLatency: boolean
): [string, RequestInit] {
  if (!lowLatency) return request;
  const body = JSON.parse(String(request[1].body)) as Record<string, any>;
  switch (provider) {
    case 'openai':
      body.reasoning = { effort: 'minimal' };
      break;
    case 'groq':
      body.reasoning_effort = 'low';
      break;
    case 'gemini':
      body.generationConfig = { ...body.generationConfig, thinkingConfig: { thinkingBudget: 0 } };
      break;
    case 'deepseek':
      // V4 models think by default; reasoning adds tens of seconds to a short answer.
      body.thinking = { type: 'disabled' };
      break;
    default:
      return request;
  }
  return [request[0], { ...request[1], body: JSON.stringify(body) }];
}

function buildGenerationRequest(
  provider: AiProvider,
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  maxOutputTokens: number
): [string, RequestInit] {
  const common: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '',
  };

  switch (provider) {
    case 'openai':
      return [
        `${baseUrl}/responses`,
        {
          ...common,
          headers: { ...common.headers, authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            input: prompt,
            max_output_tokens: maxOutputTokens,
            store: false,
          }),
        },
      ];
    case 'anthropic':
      return [
        messagesUrl(baseUrl),
        {
          ...common,
          headers: {
            ...common.headers,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxOutputTokens,
            messages: [{ role: 'user', content: prompt }],
          }),
        },
      ];
    case 'gemini':
      return [
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          ...common,
          headers: { ...common.headers, 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens, responseMimeType: 'application/json' },
          }),
        },
      ];
    case 'deepseek':
    case 'groq':
      return openAiCompatibleRequest(baseUrl, model, apiKey, prompt, maxOutputTokens);
    case 'minimax':
      return anthropicCompatibleRequest(baseUrl, model, apiKey, prompt, maxOutputTokens);
  }
}

function extractGenerationResult(
  provider: AiProvider,
  payload: unknown
): AiProviderGenerationResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid provider payload.');
  }
  const record = payload as Record<string, any>;
  switch (provider) {
    case 'openai': {
      const text = record.output
        ?.flatMap((item: any) => item?.content || [])
        .find((content: any) => content?.type === 'output_text')?.text;
      return generationResult(
        text,
        record.id,
        record.usage?.input_tokens,
        record.usage?.output_tokens
      );
    }
    case 'anthropic': {
      const text = record.content?.find((item: any) => item?.type === 'text')?.text;
      return generationResult(
        text,
        record.id,
        record.usage?.input_tokens,
        record.usage?.output_tokens
      );
    }
    case 'gemini': {
      const text = record.candidates?.[0]?.content?.parts?.find(
        (item: any) => typeof item?.text === 'string'
      )?.text;
      return generationResult(
        text,
        record.responseId,
        record.usageMetadata?.promptTokenCount,
        record.usageMetadata?.candidatesTokenCount
      );
    }
    case 'deepseek':
    case 'groq': {
      const text = record.choices?.[0]?.message?.content;
      return generationResult(
        text,
        record.id,
        record.usage?.prompt_tokens,
        record.usage?.completion_tokens
      );
    }
    case 'minimax': {
      const text = record.content?.find((item: any) => item?.type === 'text')?.text;
      return generationResult(
        text,
        record.id,
        record.usage?.input_tokens,
        record.usage?.output_tokens
      );
    }
  }
}

// Anthropic-style bases exclude the version segment; tolerate a pasted `/v1` suffix.
function messagesUrl(baseUrl: string): string {
  return baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
}

function openAiCompatibleRequest(
  baseUrl: string,
  model: string,
  apiKey: string,
  content: string,
  maxTokens: number
): [string, RequestInit] {
  return [
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    },
  ];
}

function anthropicCompatibleRequest(
  baseUrl: string,
  model: string,
  apiKey: string,
  content: string,
  maxTokens: number
): [string, RequestInit] {
  return [
    messagesUrl(baseUrl),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
    },
  ];
}

function generationResult(
  text: unknown,
  providerRequestId: unknown,
  inputTokens: unknown,
  outputTokens: unknown
): AiProviderGenerationResult {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Provider did not return text.');
  }
  return {
    text,
    providerRequestId: typeof providerRequestId === 'string' ? providerRequestId : undefined,
    inputTokens: integerOrUndefined(inputTokens),
    outputTokens: integerOrUndefined(outputTokens),
  };
}

function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function classifyFailure(response: Response): Promise<AiProviderValidationErrorCode> {
  if (response.status === 401 || response.status === 403) {
    return 'invalid_api_key';
  }
  if (response.status === 429) {
    return 'insufficient_quota';
  }
  if (response.status === 404) {
    return 'model_access';
  }
  if (response.status === 400) {
    // Gemini rejects unknown keys with 400 API_KEY_INVALID rather than 401.
    const body = await response.text().catch(() => '');
    return /api[_\s-]*key/i.test(body) ? 'invalid_api_key' : 'service_unavailable';
  }

  // Provider error bodies can contain account or organization details. Do not retain them.
  await response.body?.cancel().catch(() => undefined);
  return 'service_unavailable';
}

async function classifyGenerationFailure(
  response: Response
): Promise<{ code: AiProviderGenerationError['code']; retryAfterMs?: number }> {
  if (response.status === 401) return { code: 'invalid_api_key' };
  if (response.status === 402) return { code: 'insufficient_quota' };
  if (response.status === 404) return { code: 'model_access' };
  if (response.status === 400) {
    const body = await response.text().catch(() => '');
    return { code: /model|deployment/i.test(body) ? 'model_access' : 'provider_request_failed' };
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    return { code: /model|deployment/i.test(body) ? 'model_access' : 'invalid_api_key' };
  }
  if (response.status === 429) {
    const body = await response.text().catch(() => '');
    const quotaRelated = /insufficient[_\s-]*quota|billing|credit|balance|payment/i.test(body);
    return {
      code: quotaRelated ? 'insufficient_quota' : 'rate_limited',
      retryAfterMs: quotaRelated ? undefined : parseRetryAfter(response.headers.get('retry-after')),
    };
  }
  await response.body?.cancel().catch(() => undefined);
  return { code: response.status >= 500 ? 'service_unavailable' : 'provider_request_failed' };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, 15 * 60_000) : undefined;
}
