import type { AiProvider } from '@bookmark-assistant/types';
import {
  AI_PROVIDER_DEFAULT_MODELS,
  AiProviderValidationError,
  officialProviderForBaseUrl,
  type AiProviderAdapter,
} from './ai-provider-adapters';

export interface DetectedAiProvider {
  provider: AiProvider;
  model: string;
  /** Null means the provider's official endpoint. */
  baseUrl: string | null;
}

export interface AiProviderDetectionDependencies {
  adapterFor(provider: AiProvider, baseUrl?: string): AiProviderAdapter;
  isAllowed(provider: AiProvider): Promise<boolean>;
}

export class AiProviderDetectionError extends Error {
  readonly code = 'provider_not_detected';
  constructor() {
    super('No supported AI provider accepted this API key.');
    this.name = 'AiProviderDetectionError';
  }
}

export class AiProviderPausedError extends Error {
  constructor() {
    super('Every matching AI provider is paused.');
    this.name = 'AiProviderPausedError';
  }
}

// Order for every custom endpoint probe, and the fallback for keys without a strong prefix.
const ALL_PROVIDERS: readonly AiProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'groq',
  'minimax',
];
const AMBIGUOUS_KEY_PROVIDERS: readonly AiProvider[] = ['openai', 'deepseek', 'minimax'];

/**
 * Orders the providers a key could belong to. Anthropic, Gemini and Groq keys
 * carry documented prefixes, so other keys are never sent to those providers.
 * Prefixes only choose candidates; every result is still verified by a provider call.
 */
export function candidateProvidersForKey(apiKey: string): AiProvider[] {
  const key = apiKey.trim();
  if (key.startsWith('sk-ant-')) return ['anthropic'];
  if (key.startsWith('AIza')) return ['gemini'];
  if (key.startsWith('gsk_')) return ['groq'];
  if (/^sk-(proj|svcacct|admin)-/.test(key)) return ['openai'];
  if (/^sk-[0-9a-f]{32}$/.test(key)) return ['deepseek', 'openai', 'minimax'];
  if (key.startsWith('eyJ')) return ['minimax', 'openai', 'deepseek'];
  return [...AMBIGUOUS_KEY_PROVIDERS];
}

/**
 * Finds the supported provider that accepts the key. An official provider host
 * in `baseUrl` pins that provider; any other `baseUrl` is a custom endpoint that
 * is probed with every supported protocol. `baseUrl` must already satisfy the
 * deployment's endpoint policy.
 */
export async function detectAiProvider(
  input: { apiKey: string; baseUrl?: string | null; provider?: AiProvider },
  dependencies: AiProviderDetectionDependencies
): Promise<DetectedAiProvider> {
  const apiKey = input.apiKey.trim();
  const officialProvider = input.baseUrl ? officialProviderForBaseUrl(input.baseUrl) : undefined;
  const customBaseUrl = input.baseUrl && !officialProvider ? input.baseUrl : undefined;

  const ordered = input.provider
    ? [input.provider]
    : officialProvider
      ? [officialProvider]
      : customBaseUrl
        ? prioritize(ALL_PROVIDERS, candidateProvidersForKey(apiKey))
        : candidateProvidersForKey(apiKey);
  const allowed = await filterAllowed(ordered, dependencies);
  if (!allowed.length) throw new AiProviderPausedError();

  // Probes run in parallel so an ambiguous key costs one round trip, not several.
  const outcomes = await Promise.all(
    allowed.map(async (provider) => {
      try {
        await dependencies.adapterFor(provider, customBaseUrl).validateApiKey(apiKey);
        return { provider, error: undefined };
      } catch (error) {
        if (error instanceof AiProviderValidationError) return { provider, error };
        return {
          provider,
          error: new AiProviderValidationError('service_unavailable', provider),
        };
      }
    })
  );

  const accepted = outcomes.find((outcome) => !outcome.error);
  if (accepted) {
    return {
      provider: accepted.provider,
      model: AI_PROVIDER_DEFAULT_MODELS[accepted.provider],
      baseUrl: customBaseUrl ?? null,
    };
  }

  // The key authenticated but cannot be used. On a custom endpoint a 404 usually
  // means the route does not exist there, so it does not identify the provider.
  const recognized = outcomes.find(
    ({ error }) =>
      error?.code === 'insufficient_quota' || (!customBaseUrl && error?.code === 'model_access')
  );
  if (recognized?.error) throw recognized.error;

  // An unreachable official provider might be the right one; do not claim detection failed.
  const unavailable = !customBaseUrl
    ? outcomes.find(({ error }) => error?.code === 'service_unavailable')
    : undefined;
  if (unavailable?.error) throw unavailable.error;

  throw new AiProviderDetectionError();
}

function prioritize(all: readonly AiProvider[], first: AiProvider[]): AiProvider[] {
  return [...first, ...all.filter((provider) => !first.includes(provider))];
}

async function filterAllowed(
  providers: AiProvider[],
  dependencies: AiProviderDetectionDependencies
): Promise<AiProvider[]> {
  const allowed = await Promise.all(providers.map((provider) => dependencies.isAllowed(provider)));
  return providers.filter((_, index) => allowed[index]);
}
