import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER_HOST_PERMISSIONS, type FetchLike } from '../ai/providers';
import manifest from '../../public/manifest.json';
import {
  LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY,
  OrganizeError,
  deleteOrganizeKey,
  isOrganizeSenderAllowed,
  readOrganizeKeySummary,
  runOrganizeBatch,
  saveOrganizeKey,
} from './library-organize';

const EXTENSION_ORIGIN = 'chrome-extension://organize-test/';
let storage: Record<string, unknown>;
let grantedOrigins: Set<string>;

beforeEach(() => {
  storage = {};
  grantedOrigins = new Set();
  vi.stubGlobal('chrome', {
    runtime: { id: 'organize-test', getURL: (path: string) => `${EXTENSION_ORIGIN}${path}` },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    permissions: {
      contains: vi.fn(async ({ origins }: { origins: string[] }) =>
        origins.every((origin) => grantedOrigins.has(origin))
      ),
      remove: vi.fn(async ({ origins }: { origins: string[] }) => {
        origins.forEach((origin) => grantedOrigins.delete(origin));
        return true;
      }),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown = {}): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const batch = {
  items: [
    {
      id: '100',
      parentId: '1',
      title: 'Figma tips',
      url: 'https://figma.com/blog',
      folderPath: 'Bookmarks Bar',
    },
  ],
  folders: [{ id: '10', path: 'Bookmarks Bar / Design' }],
};

function openAiText(text: string) {
  return { id: 'resp', output: [{ content: [{ type: 'output_text', text }] }] };
}

describe('organize key storage', () => {
  it('requires the provider host permission before validating a key', async () => {
    const fetcher = respond(200);
    await expect(saveOrganizeKey('openai', 'sk-test-1234', fetcher)).rejects.toMatchObject({
      code: 'permission_required',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]).toBeUndefined();
  });

  it('stores a validated key and exposes only the provider and last four characters', async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await expect(saveOrganizeKey('openai', '  sk-test-1234  ', respond(200))).resolves.toEqual({
      provider: 'openai',
      last4: '1234',
    });
    expect(storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-test-1234',
    });
    await expect(readOrganizeKeySummary()).resolves.toEqual({ provider: 'openai', last4: '1234' });
  });

  it('does not store a key the provider rejects and releases the new permission', async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await expect(saveOrganizeKey('openai', 'sk-bad', respond(401))).rejects.toMatchObject({
      code: 'invalid_api_key',
    });
    expect(storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]).toBeUndefined();
    expect(grantedOrigins.has('https://api.openai.com/*')).toBe(false);
  });

  it('keeps the stored provider permission when a replacement key for it is rejected', async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await saveOrganizeKey('openai', 'sk-good-1234', respond(200));
    await expect(saveOrganizeKey('openai', 'sk-bad', respond(401))).rejects.toBeInstanceOf(
      OrganizeError
    );
    expect(grantedOrigins.has('https://api.openai.com/*')).toBe(true);
  });

  it('releases the previous provider permission after switching providers', async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await saveOrganizeKey('openai', 'sk-test-1234', respond(200));
    grantedOrigins.add('https://api.anthropic.com/*');
    await saveOrganizeKey('anthropic', 'sk-ant-5678', respond(200));

    expect([...grantedOrigins]).toEqual(['https://api.anthropic.com/*']);
  });

  it.each([
    ['unknown', 'key'],
    ['openai', '   '],
    ['openai', 'x'.repeat(513)],
  ])('rejects invalid input %s', async (provider, apiKey) => {
    await expect(saveOrganizeKey(provider, apiKey, respond(200))).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('clears the key and releases the provider permission', async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await saveOrganizeKey('openai', 'sk-test-1234', respond(200));
    await deleteOrganizeKey();
    expect(storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]).toBeUndefined();
    expect(grantedOrigins.has('https://api.openai.com/*')).toBe(false);
    await expect(readOrganizeKeySummary()).resolves.toBeNull();
  });

  it('ignores a malformed stored key', async () => {
    storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY] = { provider: 'nope', apiKey: 1 };
    await expect(readOrganizeKeySummary()).resolves.toBeNull();
  });
});

describe('runOrganizeBatch', () => {
  beforeEach(async () => {
    grantedOrigins.add('https://api.openai.com/*');
    await saveOrganizeKey('openai', 'sk-test-1234', respond(200));
  });

  it('asks the provider for a plan and returns validated proposals', async () => {
    const fetcher = respond(
      200,
      openAiText('{"moves":[{"item":"b1","folder":"f1","reason":"Design"}]}')
    );
    const result = await runOrganizeBatch(batch, 'en', fetcher);

    expect(result.proposals).toEqual([
      { bookmarkId: '100', fromParentId: '1', toFolderId: '10', reason: 'Design' },
    ]);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(String(init?.body)).toContain('"max_output_tokens":6000');
    expect(String(init?.body)).toContain('"reasoning":{"effort":"minimal"}');
    expect(String(init?.body)).toContain('Figma tips');
  });

  it('reports a missing key without calling a provider', async () => {
    await deleteOrganizeKey();
    const fetcher = respond(200);
    await expect(runOrganizeBatch(batch, 'en', fetcher)).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a revoked permission', async () => {
    grantedOrigins.clear();
    await expect(runOrganizeBatch(batch, 'en', respond(200))).rejects.toMatchObject({
      code: 'permission_required',
    });
  });

  it('passes the provider retry delay through', async () => {
    const fetcher: FetchLike = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '3' } })
    );
    await expect(runOrganizeBatch(batch, 'en', fetcher)).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 3_000,
    });
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'invalid_api_key'],
    [503, 'service_unavailable'],
  ])('maps provider status %s to %s', async (status, code) => {
    await expect(runOrganizeBatch(batch, 'en', respond(status))).rejects.toMatchObject({ code });
  });

  it('reports output that is not an organization plan', async () => {
    await expect(
      runOrganizeBatch(batch, 'en', respond(200, openAiText('I cannot help')))
    ).rejects.toBeInstanceOf(OrganizeError);
    await expect(
      runOrganizeBatch(batch, 'en', respond(200, openAiText('I cannot help')))
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([
    { items: [], folders: batch.folders },
    { items: batch.items, folders: [] },
    { items: Array.from({ length: 16 }, () => batch.items[0]), folders: batch.folders },
    { items: [{ ...batch.items[0], url: 'http://localhost/secret' }], folders: batch.folders },
    { items: 'nope', folders: batch.folders },
  ])('rejects a malformed batch', async (invalidBatch) => {
    const fetcher = respond(200);
    await expect(runOrganizeBatch(invalidBatch as never, 'en', fetcher)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('isOrganizeSenderAllowed', () => {
  it('accepts only this extension’s own pages', () => {
    expect(
      isOrganizeSenderAllowed({ id: 'organize-test', url: `${EXTENSION_ORIGIN}options.html` })
    ).toBe(true);
    expect(
      isOrganizeSenderAllowed({
        id: 'organize-test',
        url: 'https://evil.example/',
        tab: {} as never,
      })
    ).toBe(false);
    expect(
      isOrganizeSenderAllowed({ id: 'other', url: 'chrome-extension://other/options.html' })
    ).toBe(false);
  });
});

it('declares exactly the provider origins as optional, never install-time, permissions', () => {
  expect([...manifest.optional_host_permissions].sort()).toEqual(
    Object.values(AI_PROVIDER_HOST_PERMISSIONS).sort()
  );
  expect(manifest.host_permissions).toEqual([]);
});
