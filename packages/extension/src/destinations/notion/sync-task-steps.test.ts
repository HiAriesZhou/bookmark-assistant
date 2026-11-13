import { describe, expect, it, vi } from 'vitest';
import { createSyncStepper, initialSyncState } from './sync-task-steps';
import { buildBookmarkPropertiesFromNotionSchema } from './core';
import type { LinkItem } from '@bookmark-assistant/types';

const links = [
  { title: 'Example', url: 'https://example.com', syncId: 'stable', type: 'bookmark' as const },
];
function fixture() {
  const api = {
    verifyDatabaseAccess: vi.fn(async () => ({ databaseId: 'db', dataSourceId: 'ds' })),
    existingLinksPage: vi.fn(async () => ({
      records: [],
      urls: [],
      syncIds: [],
      describedPageIds: [],
    })),
    buildPropertiesFromDataSource: vi.fn(async () => ({ Name: { title: [] } })),
    createPage: vi.fn(async () => ({ id: 'new-page' })),
    updatePage: vi.fn(async () => undefined),
    findPageBySyncId: vi.fn(async (): Promise<string | undefined> => undefined),
    findPageByUrlAndType: vi.fn(async (): Promise<string | undefined> => undefined),
  };
  const deps = {
    api,
    assertCurrent: async () => undefined,
    protectDescription: vi.fn(async () => undefined),
    enrich: async (item: (typeof links)[number]) => item,
    fillDescription: vi.fn(async () => undefined),
  };
  return { api, deps, step: createSyncStepper(deps) };
}

async function advanceToWrite(step: ReturnType<typeof createSyncStepper>) {
  let state = initialSyncState();
  for (let i = 0; i < 8 && state.phase !== 'write'; i++)
    state = (await step(links, 'db', state)).state;
  expect(state.phase).toBe('write');
  return state;
}

describe('resumable Notion sync', () => {
  it('preserves protected notes when a custom schema has no folder or type field', async () => {
    const f = fixture();
    let notes = 'User notes';
    const step = createSyncStepper({
      ...f.deps,
      api: {
        ...f.api,
        existingLinksPage: async () => ({
          records: [{ pageId: 'p', url: links[0].url, syncId: links[0].syncId }],
          urls: [links[0].url],
          syncIds: [links[0].syncId],
          describedPageIds: ['p'],
        }),
        buildPropertiesFromDataSource: async (_id, _token, item, options) =>
          buildBookmarkPropertiesFromNotionSchema(
            {
              Name: { type: 'title' },
              Description: { type: 'rich_text' },
              'Sync ID': { type: 'rich_text' },
            },
            item,
            options
          ),
        updatePage: async (_id, properties) => {
          const description = properties.Description as
            | { rich_text: Array<{ text: { content: string } }> }
            | undefined;
          if (description) notes = description.rich_text[0].text.content;
        },
      },
    });
    let state = initialSyncState();
    for (let i = 0; i < 10 && state.phase !== 'done'; i++)
      state = (await step([{ ...links[0], path: 'Bookmarks' }], 'db', state)).state;
    expect(f.deps.protectDescription).toHaveBeenCalledWith('p');
    expect(state.phase).toBe('done');
    expect(notes).toBe('User notes');
  });

  it('creates base properties without a description fallback in a schema with no folder', async () => {
    const f = fixture();
    const item = { ...links[0], path: 'Bookmarks', description: 'Guarded summary' };
    const step = createSyncStepper({
      ...f.deps,
      api: {
        ...f.api,
        buildPropertiesFromDataSource: async (_id, _token, bookmark, options) =>
          buildBookmarkPropertiesFromNotionSchema(
            {
              Name: { type: 'title' },
              URL: { type: 'url' },
              Description: { type: 'rich_text' },
              'Sync ID': { type: 'rich_text' },
            },
            bookmark,
            options
          ),
      },
    });
    let state = initialSyncState();
    for (let i = 0; i < 10 && state.phase !== 'done'; i++)
      state = (await step([item], 'db', state)).state;
    expect(state.phase).toBe('done');
    expect(f.api.createPage).toHaveBeenCalledWith(
      { type: 'database_id', database_id: 'db' },
      {
        Name: { title: [{ text: { content: item.title } }] },
        URL: { url: item.url },
        'Sync ID': { rich_text: [{ text: { content: item.syncId } }] },
      },
      ''
    );
    expect(f.deps.fillDescription).toHaveBeenCalledWith('new-page', 'Guarded summary');
  });

  it('rechecks the URL after another task creates the same link with a different sync ID', async () => {
    const f = fixture();
    const rows: Array<LinkItem & { id: string }> = [];
    const api = {
      ...f.api,
      buildPropertiesFromDataSource: async (_id: string, _token: string, item: LinkItem) => ({
        ...item,
      }),
      findPageBySyncId: async (_id: string, _token: string, syncId: string) =>
        rows.find((row) => row.syncId === syncId)?.id,
      findPageByUrlAndType: async (
        _id: string,
        _token: string,
        url: string,
        type?: LinkItem['type']
      ) =>
        rows.find((row) => row.url === url && (row.type ?? 'bookmark') === (type ?? 'bookmark'))
          ?.id,
      createPage: vi.fn(async (_parent: unknown, item: Record<string, unknown>) => {
        const row = { ...(item as unknown as LinkItem), id: `page-${rows.length}` };
        rows.push(row);
        return row;
      }),
    };
    const first = createSyncStepper({ ...f.deps, api });
    const second = createSyncStepper({ ...f.deps, api });
    const captured = [{ ...links[0], syncId: 'quick-save' }];
    let a = initialSyncState();
    let b = initialSyncState();
    for (let i = 0; i < 5; i++) {
      a = (await first(links, 'db', a)).state;
      b = (await second(captured, 'db', b)).state;
    }
    expect(api.createPage).toHaveBeenCalledTimes(1);
    expect(b.pageId).toBe(a.pageId);
    expect(a.created).toBe(1);
    expect(b.created).toBe(0);
  });

  it('resumes completed items without creating them again', async () => {
    const f = fixture();
    const intent = await advanceToWrite(f.step);
    const written = await f.step(links, 'db', intent);
    expect(f.api.createPage).toHaveBeenCalledTimes(1);
    const afterRestart = createSyncStepper(f.deps);
    let state = written.state;
    for (let i = 0; i < 5 && state.phase !== 'done'; i++)
      state = (await afterRestart(links, 'db', state)).state;
    expect(state.phase).toBe('done');
    expect(f.api.createPage).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost create response on a new worker instead of recreating', async () => {
    const f = fixture();
    const intent = await advanceToWrite(f.step);
    f.api.findPageBySyncId.mockResolvedValue('already-created');
    const recovered = await createSyncStepper(f.deps)(links, 'db', intent);
    expect(f.api.createPage).not.toHaveBeenCalled();
    expect(recovered.state.pageId).toBe('already-created');
  });

  it('stops an uncertain create when the remote row cannot be confirmed', async () => {
    const f = fixture();
    const intent = await advanceToWrite(f.step);
    await expect(createSyncStepper(f.deps)(links, 'db', intent)).rejects.toThrow(
      'NOTION_WRITE_UNCERTAIN'
    );
    expect(f.api.createPage).not.toHaveBeenCalled();
  });

  it('does not create anything from a partial remote scan', async () => {
    const f = fixture();
    f.api.existingLinksPage.mockRejectedValue(new Error('scan failed'));
    const state = (await f.step(links, 'db', initialSyncState())).state;
    await expect(f.step(links, 'db', state)).rejects.toThrow('scan failed');
    expect(f.api.createPage).not.toHaveBeenCalled();
  });

  it('keeps basic sync available when optional AI fails', async () => {
    const f = fixture();
    f.deps.enrich = async () => {
      throw new Error('provider unavailable');
    };
    const step = createSyncStepper(f.deps);
    let state = initialSyncState();
    for (let i = 0; i < 12 && state.phase !== 'done'; i++)
      state = (await step(links, 'db', state)).state;
    expect(state.phase).toBe('done');
    expect(f.api.createPage).toHaveBeenCalledTimes(1);
  });
});
