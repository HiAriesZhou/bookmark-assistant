import { describe, expect, it, vi } from 'vitest';
import { NotionApi, type CreateNotionClient } from './notion-api';

function fixture() {
  const client = {
    pages: { retrieve: vi.fn(), update: vi.fn() },
    dataSources: {
      query: vi.fn(),
      retrieve: vi.fn(
        async (): Promise<{ properties: Record<string, { type: string }> }> => ({
          properties: { URL: { type: 'url' } },
        })
      ),
    },
  };
  const api = new NotionApi((() => client) as unknown as CreateNotionClient, async () => undefined);
  return { api, client };
}

describe('Notion runtime operations', () => {
  it('rechecks the same URL property that the writer selects in a multi-URL schema', async () => {
    const { api, client } = fixture();
    client.dataSources.retrieve.mockResolvedValue({
      properties: {
        'Reference URL': { type: 'url' },
        URL: { type: 'url' },
        Name: { type: 'title' },
      },
    });
    client.dataSources.query.mockImplementation(async ({ filter }) => ({
      results:
        filter?.property === 'URL'
          ? [
              {
                id: 'saved',
                properties: {
                  'Reference URL': { type: 'url', url: 'https://reference.example' },
                  URL: { type: 'url', url: 'https://example.com' },
                },
              },
            ]
          : [],
      has_more: false,
    }));
    expect(
      await api.buildPropertiesFromDataSource(
        'ds',
        'token',
        {
          title: 'Example',
          url: 'https://example.com',
        },
        { omitDescription: true }
      )
    ).toMatchObject({ URL: { url: 'https://example.com' } });
    expect(await api.findPageByUrlAndType('ds', 'token', 'https://example.com')).toBe('saved');
  });

  it('finds a typed URL on a later page without matching the other link type', async () => {
    const { api, client } = fixture();
    const row = (id: string, type: string) => ({
      id,
      properties: {
        URL: { type: 'url', url: 'https://example.com' },
        Type: { type: 'select', select: { name: type } },
      },
    });
    client.dataSources.query
      .mockResolvedValueOnce({
        results: [row('bookmark', 'Bookmark')],
        has_more: true,
        next_cursor: 'next',
      })
      .mockResolvedValueOnce({ results: [row('reading', 'Reading List')], has_more: false });
    expect(
      await api.findPageByUrlAndType('ds', 'token', 'https://example.com', 'reading_list')
    ).toBe('reading');
    expect(client.dataSources.query).toHaveBeenNthCalledWith(2, {
      data_source_id: 'ds',
      filter: { property: 'URL', url: { equals: 'https://example.com' } },
      page_size: 100,
      start_cursor: 'next',
    });
  });

  it('treats a legacy row with no type as a bookmark', async () => {
    const { api, client } = fixture();
    client.dataSources.query.mockResolvedValue({
      results: [{ id: 'legacy', properties: { URL: { type: 'url', url: 'https://example.com' } } }],
      has_more: false,
    });
    expect(await api.findPageByUrlAndType('ds', 'token', 'https://example.com')).toBe('legacy');
  });

  it('reads a single cursor page and retains description ownership observations', async () => {
    const { api, client } = fixture();
    client.dataSources.query.mockResolvedValue({
      results: [
        {
          id: 'p',
          properties: {
            URL: { type: 'url', url: 'https://example.com' },
            Description: { type: 'rich_text', rich_text: [{ plain_text: 'user notes' }] },
          },
        },
      ],
      next_cursor: 'next',
      has_more: true,
    });
    const result = await api.existingLinksPage('ds', 'token', 'cursor');
    expect(client.dataSources.query).toHaveBeenCalledWith({
      data_source_id: 'ds',
      page_size: 100,
      start_cursor: 'cursor',
    });
    expect(result.cursor).toBe('next');
    expect(result.records[0]).toMatchObject({ pageId: 'p', hasDescription: true });
  });

  it('does not use a folder field as a missing description', async () => {
    const { api, client } = fixture();
    client.pages.retrieve.mockResolvedValue({
      properties: { Folder: { type: 'rich_text', rich_text: [] } },
    });
    expect(await api.readDescription('p', 'token')).toBeUndefined();
  });

  it('updates only the description property and never blindly retries it', async () => {
    const { api, client } = fixture();
    client.pages.update.mockRejectedValue(
      Object.assign(new Error('unknown outcome'), { status: 502 })
    );
    await expect(api.writeDescription('p', 'Summary', 'intro', 'token')).rejects.toThrow(
      'unknown outcome'
    );
    expect(client.pages.update).toHaveBeenCalledTimes(1);
    expect(client.pages.update).toHaveBeenCalledWith({
      page_id: 'p',
      properties: { Summary: { rich_text: [{ text: { content: 'intro' } }] } },
    });
  });
});
