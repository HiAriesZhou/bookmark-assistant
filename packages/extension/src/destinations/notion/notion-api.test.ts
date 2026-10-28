import { describe, expect, it, vi } from 'vitest';
import { NotionApi, type CreateNotionClient } from './notion-api';

const TOKEN = 'ntn_test';
const rateLimited = () => Object.assign(new Error('rate limited'), { status: 429 });

function fakeClient(overrides: Record<string, any> = {}) {
  const client = {
    request: vi.fn(),
    search: vi.fn(),
    users: { me: vi.fn() },
    pages: { create: vi.fn(), update: vi.fn() },
    dataSources: { retrieve: vi.fn(), query: vi.fn() },
    ...overrides,
  };
  const createClient = vi.fn(() => client) as unknown as CreateNotionClient;
  return { client, api: new NotionApi(createClient, async () => undefined) };
}

const row = (url: string, syncId: string) => ({
  id: `page-${syncId}`,
  properties: {
    URL: { type: 'url', url },
    'Sync ID': { type: 'rich_text', rich_text: [{ plain_text: syncId }] },
  },
});

describe('NotionApi', () => {
  it('returns the primary data source and title of an accessible database', async () => {
    const { client, api } = fakeClient();
    client.request.mockResolvedValue({
      object: 'database',
      title: [{ plain_text: 'Bookmarks' }],
      data_sources: [{ id: 'ds-1' }],
    });
    await expect(api.verifyDatabaseAccess('db-1', TOKEN)).resolves.toEqual({
      databaseId: 'db-1',
      dataSourceId: 'ds-1',
      title: 'Bookmarks',
    });
  });

  it('rejects a page that is not a database', async () => {
    const { client, api } = fakeClient();
    client.request.mockResolvedValue({ object: 'page' });
    await expect(api.verifyDatabaseAccess('page-1', TOKEN)).rejects.toThrow('not a database');
  });

  it('retries rate-limited reads but never retries page creation', async () => {
    const { client, api } = fakeClient();
    client.pages.update.mockRejectedValueOnce(rateLimited()).mockResolvedValue({ id: 'p' });
    await api.updatePage('p', {}, TOKEN);
    expect(client.pages.update).toHaveBeenCalledTimes(2);

    client.pages.create.mockRejectedValue(rateLimited());
    await expect(
      api.createPage({ type: 'database_id', database_id: 'db' }, {}, TOKEN)
    ).rejects.toThrow('rate limited');
    expect(client.pages.create).toHaveBeenCalledTimes(1);
  });

  it('reads the data source schema once for several pages', async () => {
    const { client, api } = fakeClient();
    client.dataSources.retrieve.mockResolvedValue({
      properties: { Name: { type: 'title' }, URL: { type: 'url' } },
    });
    const item = { title: 'A', url: 'https://a.example' } as any;
    const first = await api.buildPropertiesFromDataSource('ds', TOKEN, item);
    await api.buildPropertiesFromDataSource('ds', TOKEN, item);
    expect(client.dataSources.retrieve).toHaveBeenCalledTimes(1);
    expect(Object.keys(first)).toEqual(expect.arrayContaining(['Name', 'URL']));
  });

  it('pages through every existing row, past the old 5,000-row cap', async () => {
    const { client, api } = fakeClient();
    for (let page = 0; page < 60; page++) {
      client.dataSources.query.mockResolvedValueOnce({
        results: [row(`https://a.example/${page}`, `s${page}`)],
        next_cursor: page < 59 ? `c${page + 1}` : null,
      });
    }
    const links = await api.existingLinks('ds', TOKEN);
    expect(links.urls).toHaveLength(60);
    expect(links.records[0]).toMatchObject({ pageId: 'page-s0', syncId: 's0' });
  });

  it('fails instead of planning writes against a partial row index', async () => {
    const { client, api } = fakeClient();
    client.dataSources.query
      .mockResolvedValueOnce({ results: [row('https://a.example', 'a')], next_cursor: 'c2' })
      .mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    await expect(api.existingLinks('ds', TOKEN)).rejects.toThrow('bad request');
  });

  it('lists databases and standalone pages but not database rows', async () => {
    const { client, api } = fakeClient();
    client.search.mockImplementation(async ({ filter }: any) =>
      filter.value === 'data_source'
        ? {
            results: [
              { id: 'ds-1', title: [{ plain_text: 'Bookmarks' }], parent: { database_id: 'db-1' } },
            ],
          }
        : {
            results: [
              {
                id: 'page-1',
                parent: { type: 'workspace' },
                properties: { title: { type: 'title', title: [{ plain_text: 'Inbox' }] } },
              },
              { id: 'row-1', parent: { type: 'data_source_id' }, properties: {} },
            ],
          }
    );
    await expect(api.listTargets(TOKEN)).resolves.toEqual({
      databases: [{ id: 'db-1', title: 'Bookmarks' }],
      pages: [{ id: 'page-1', title: 'Inbox' }],
    });
  });

  it('looks up the database of a data source that search returned without a parent', async () => {
    const { client, api } = fakeClient();
    client.search.mockImplementation(async ({ filter }: any) =>
      filter.value === 'data_source'
        ? { results: [{ object: 'data_source', id: 'ds-2', properties: {} }] }
        : { results: [] }
    );
    client.dataSources.retrieve.mockResolvedValue({
      id: 'ds-2',
      title: [{ plain_text: 'Reading' }],
      parent: { type: 'database_id', database_id: 'db-2' },
    });
    await expect(api.listTargets(TOKEN)).resolves.toEqual({
      databases: [{ id: 'db-2', title: 'Reading' }],
      pages: [],
    });
    expect(client.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: 'ds-2' });
  });

  it('creates a database whose fields match the property matchers', async () => {
    const { client, api } = fakeClient();
    client.request.mockResolvedValue({ id: 'db-new' });
    await expect(api.createBookmarkDatabase(TOKEN, 'page-1', 'Bookmarks')).resolves.toEqual({
      databaseId: 'db-new',
    });
    const body = client.request.mock.calls[0][0].body;
    expect(body.parent).toEqual({ type: 'page_id', page_id: 'page-1' });
    const created = body.initial_data_source.properties;
    // A sample link maps onto every created field.
    const { buildBookmarkPropertiesFromNotionSchema } = await import('./core');
    const schema = Object.fromEntries(
      Object.entries(created).map(([name, definition]) => [
        name,
        { type: Object.keys(definition as object)[0] },
      ])
    );
    const mapped = buildBookmarkPropertiesFromNotionSchema(schema, {
      title: 'A',
      url: 'https://a.example',
      tags: ['x'],
      description: 'd',
      path: 'Bar',
      dateAdded: '2026-10-28T00:00:00.000Z',
      syncId: 'a',
      type: 'reading_list',
      readState: 'READ',
    } as any);
    expect(Object.keys(mapped).sort()).toEqual(Object.keys(created).sort());
  });

  it("reports an integration's workspace name", async () => {
    const { client, api } = fakeClient();
    client.users.me.mockResolvedValue({ name: 'BA', bot: { workspace_name: 'Aries' } });
    await expect(api.getSelf(TOKEN)).resolves.toEqual({ name: 'BA', workspaceName: 'Aries' });
  });
});
