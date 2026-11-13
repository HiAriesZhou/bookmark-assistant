import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkItem } from '@bookmark-assistant/types';
import { enrichLinkDescriptions } from './link-description';
import { LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY } from './library-organize';
import {
  BOOKMARK_METADATA_STORAGE_KEY,
  readBookmarkMetadata,
  saveBookmarkMetadata,
} from '../library/bookmark-metadata';

let storage: Record<string, unknown>;
const bookmark: LinkItem = {
  title: 'Example reference',
  url: 'https://example.com/reference?private=secret#section',
  path: 'Research',
  source: 'chrome_bookmark',
  syncId: 'chrome-bookmark-42',
};
const current = async () => true;
const response = () =>
  new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: '{"descriptions":[{"id":"l0","description":"A reference resource."}]}',
            },
          ],
        },
      ],
    }),
    { status: 200 }
  );

beforeEach(() => {
  storage = {
    notion_token: 'synthetic-notion',
    notion_database: { id: 'database' },
    destination_revision: 'destination-1',
    [LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]: {
      provider: 'openai',
      apiKey: 'synthetic-ai',
      savedAt: 'today',
      revision: 'ai-1',
    },
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]])
          )
        ),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
      },
    },
    permissions: { contains: vi.fn(async () => true) },
    i18n: { getUILanguage: () => 'en' },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('optional link description enrichment', () => {
  it('sends only bounded title, folder and sanitized URL; labels and persists inference', async () => {
    const fetcher = vi.fn(async () => response());
    const result = await enrichLinkDescriptions([bookmark], current, { fetcher });
    expect(result[0]).toMatchObject({
      description: 'AI inference: A reference resource.',
      descriptionSource: 'ai',
    });
    expect((await readBookmarkMetadata())['42']).toMatchObject({ descriptionSource: 'ai' });
    const payload = JSON.stringify(fetcher.mock.calls);
    expect(payload).toContain('https://example.com/reference');
    expect(payload).not.toContain('private=secret');
    expect(payload).not.toContain('#section');
    expect(payload).toContain('not a summary');
    expect(bookmark.description).toBeUndefined();
  });

  it('uses local user descriptions and does not resurrect a cleared description', async () => {
    await saveBookmarkMetadata('42', { description: 'User description', tags: [] });
    const fetcher = vi.fn(async () => response());
    expect((await enrichLinkDescriptions([bookmark], current, { fetcher }))[0]).toMatchObject({
      description: 'User description',
      descriptionSource: 'user',
    });
    await saveBookmarkMetadata('42', { description: '', tags: [] });
    expect(
      (await enrichLinkDescriptions([bookmark], current, { fetcher }))[0].description
    ).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['key', 'destination', 'metadata', 'guard'])(
    'drops output after %s changes during generation',
    async (change) => {
      let valid = true;
      const fetcher = vi.fn(async () => {
        if (change === 'key') delete storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY];
        if (change === 'destination') storage.destination_revision = 'destination-2';
        if (change === 'metadata') await saveBookmarkMetadata('42', { description: '', tags: [] });
        if (change === 'guard') valid = false;
        return response();
      });
      const result = await enrichLinkDescriptions([bookmark], async () => valid, { fetcher });
      expect(result[0].description).toBeUndefined();
      expect((await readBookmarkMetadata())['42']?.description).toBeUndefined();
    }
  );

  it.each(['notion', 'key', 'permission', 'history', 'private-url'])(
    'does not call AI without eligibility: %s',
    async (reason) => {
      if (reason === 'notion') delete storage.notion_token;
      if (reason === 'key') delete storage[LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY];
      if (reason === 'permission') vi.mocked(chrome.permissions.contains).mockResolvedValue(false);
      const fetcher = vi.fn(async () => response());
      await enrichLinkDescriptions(
        [{ ...bookmark, ...(reason === 'private-url' ? { url: 'http://localhost/secrets' } : {}) }],
        current,
        {
          fetcher,
          hasHistory: async () => reason === 'history',
        }
      );
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([400, 401, 429, 503])(
    'keeps basic link data and makes only one attempt after HTTP %s',
    async (status) => {
      const fetcher = vi.fn(async () => new Response('{}', { status }));
      await expect(enrichLinkDescriptions([bookmark], current, { fetcher })).resolves.toEqual([
        bookmark,
      ]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['reading_list', 'current_page', 'context_menu'] as const)(
    'supports %s without saving global bookmark metadata',
    async (source) => {
      const fetcher = vi.fn(async () => response());
      const result = await enrichLinkDescriptions([{ ...bookmark, source }], current, {
        fetcher,
        uiLanguage: 'zh-CN',
      });
      expect(result[0]).toMatchObject({
        descriptionSource: 'ai',
        description: 'AI 推断：A reference resource.',
      });
      expect(storage[BOOKMARK_METADATA_STORAGE_KEY]).toBeUndefined();
    }
  );
});
