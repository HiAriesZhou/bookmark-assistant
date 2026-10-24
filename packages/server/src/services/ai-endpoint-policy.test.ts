import { describe, expect, it, vi } from 'vitest';
import {
  AiEndpointPolicyError,
  assertAiEndpointAllowed,
  createGuardedFetcher,
  normalizeAiBaseUrl,
} from './ai-endpoint-policy';

const hosted = { allowPrivateNetwork: false };
const selfHosted = { allowPrivateNetwork: true };

describe('normalizeAiBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeAiBaseUrl('  https://llm.example.com/v1/  ', hosted)).toBe(
      'https://llm.example.com/v1'
    );
    expect(normalizeAiBaseUrl('https://llm.example.com/', hosted)).toBe('https://llm.example.com');
  });

  it.each([
    'not a url',
    'ftp://llm.example.com',
    'https://user:pass@llm.example.com',
    'https://llm.example.com/v1?key=value',
    'https://llm.example.com/v1#fragment',
    `https://llm.example.com/${'a'.repeat(2048)}`,
  ])('rejects %s', (value) => {
    expect(() => normalizeAiBaseUrl(value, selfHosted)).toThrow(AiEndpointPolicyError);
  });

  it('requires https on the default port for hosted deployments', () => {
    expect(() => normalizeAiBaseUrl('http://llm.example.com', hosted)).toThrow(
      AiEndpointPolicyError
    );
    expect(() => normalizeAiBaseUrl('https://llm.example.com:8443', hosted)).toThrow(
      AiEndpointPolicyError
    );
  });

  it('allows local http gateways for self-hosted deployments', () => {
    expect(normalizeAiBaseUrl('http://localhost:4000/v1', selfHosted)).toBe(
      'http://localhost:4000/v1'
    );
  });
});

describe('assertAiEndpointAllowed', () => {
  const publicLookup = vi.fn(async () => ['93.184.216.34']);

  it.each([
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.8/v1',
    'https://[::1]/v1',
    'https://metadata.google.internal/v1',
  ])('blocks private destination %s on hosted deployments', async (url) => {
    await expect(assertAiEndpointAllowed(url, hosted, publicLookup)).rejects.toBeInstanceOf(
      AiEndpointPolicyError
    );
  });

  it('blocks a public hostname that resolves to a private address', async () => {
    await expect(
      assertAiEndpointAllowed('https://llm.example.com/v1', hosted, async () => [
        '93.184.216.34',
        '169.254.169.254',
      ])
    ).rejects.toBeInstanceOf(AiEndpointPolicyError);
  });

  it('allows publicly resolving hosts on hosted deployments', async () => {
    await expect(
      assertAiEndpointAllowed('https://llm.example.com/v1', hosted, publicLookup)
    ).resolves.toBeUndefined();
  });

  it('does not restrict destinations for self-hosted deployments', async () => {
    const lookup = vi.fn(async () => ['10.0.0.8']);
    await expect(
      assertAiEndpointAllowed('http://10.0.0.8:4000/v1', selfHosted, lookup)
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('createGuardedFetcher', () => {
  it('checks each request destination and refuses redirects', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const guarded = createGuardedFetcher(hosted, fetcher, async () => ['93.184.216.34']);

    await guarded('https://llm.example.com/v1/responses', { method: 'POST' });
    expect(fetcher).toHaveBeenCalledWith('https://llm.example.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
    });

    await expect(guarded('https://127.0.0.1/v1/responses', { method: 'POST' })).rejects.toThrow(
      AiEndpointPolicyError
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
