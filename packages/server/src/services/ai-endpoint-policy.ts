import { lookup } from 'dns/promises';
import type { AiProvider } from '@bookmark-assistant/types';
import {
  AI_PROVIDER_DEFAULT_MODELS,
  createAiProviderAdapter,
  type AiProviderAdapter,
  type FetchLike,
} from './ai-provider-adapters';
import { isBlockedHostname, isPrivateAddress } from './public-page-fetcher';

const MAX_BASE_URL_LENGTH = 2048;

export interface AiEndpointPolicy {
  /** Self-hosted operators may point at local or LAN gateways over http. */
  allowPrivateNetwork: boolean;
}

export type ResolveAddresses = (hostname: string) => Promise<string[]>;

export class AiEndpointPolicyError extends Error {
  readonly code = 'invalid_base_url';
  constructor() {
    super('The AI Base URL is not allowed.');
    this.name = 'AiEndpointPolicyError';
  }
}

export function aiEndpointPolicy(config: { selfHosted: boolean }): AiEndpointPolicy {
  return { allowPrivateNetwork: config.selfHosted };
}

/** Validates the URL shape and returns it without a trailing slash. */
export function normalizeAiBaseUrl(raw: string, policy: AiEndpointPolicy): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiEndpointPolicyError();
  }
  const allowedProtocols = policy.allowPrivateNetwork ? ['https:', 'http:'] : ['https:'];
  if (
    value.length > MAX_BASE_URL_LENGTH ||
    !allowedProtocols.includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!policy.allowPrivateNetwork && url.port)
  ) {
    throw new AiEndpointPolicyError();
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Hosted deployments only send keys to publicly resolving hosts. This runs at
 * save time and again before every request because DNS can change later.
 */
export async function assertAiEndpointAllowed(
  rawUrl: string,
  policy: AiEndpointPolicy,
  resolveAddresses: ResolveAddresses = resolveAllAddresses
): Promise<void> {
  if (policy.allowPrivateNetwork) return;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiEndpointPolicyError();
  }
  if (url.protocol !== 'https:' || isBlockedHostname(url.hostname)) {
    throw new AiEndpointPolicyError();
  }
  const addresses = await resolveAddresses(url.hostname).catch(() => []);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new AiEndpointPolicyError();
  }
}

/** Fetcher for custom endpoints: re-checks the destination and never follows redirects. */
export function createGuardedFetcher(
  policy: AiEndpointPolicy,
  fetcher: FetchLike = fetch,
  resolveAddresses?: ResolveAddresses
): FetchLike {
  return async (input, init) => {
    await assertAiEndpointAllowed(input, policy, resolveAddresses);
    return fetcher(input, { ...init, redirect: 'error' });
  };
}

/** Builds the adapter for a saved or candidate credential. Official endpoints use plain fetch. */
export function createAiProviderAdapterForEndpoint(
  provider: AiProvider,
  policy: AiEndpointPolicy,
  options: { model?: string; baseUrl?: string | null } = {}
): AiProviderAdapter {
  const model = options.model || AI_PROVIDER_DEFAULT_MODELS[provider];
  return options.baseUrl
    ? createAiProviderAdapter(provider, createGuardedFetcher(policy), model, options.baseUrl)
    : createAiProviderAdapter(provider, fetch, model);
}

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[(.*)\]$/, '$1');
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((result) => result.address);
}
