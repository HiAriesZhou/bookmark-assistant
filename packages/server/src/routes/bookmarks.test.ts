import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notion: {
    verifyDatabaseAccess: vi.fn(),
    existingBookmarkUrls: vi.fn(),
    buildPropertiesFromDataSource: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    getAiTemplateProperties: vi.fn(),
    getPage: vi.fn(),
  },
  findUser: vi.fn(),
  extract: vi.fn(),
  getSettings: vi.fn(),
  getCredential: vi.fn(),
  createBatch: vi.fn(),
  enqueue: vi.fn(),
  existingTasks: vi.fn(),
  clock: 1_000,
}));
vi.mock('../middleware/auth', () => ({ validateSession: vi.fn() }));
vi.mock('../services/notion', () => ({ notionService: mocks.notion }));
vi.mock('../services/userPrisma', () => ({
  prisma: {},
  userPrisma: { find: mocks.findUser, resolveInternalUserId: async () => 'test-user' },
}));
vi.mock('../services/description-extractor', () => ({
  descriptionExtractor: { extractFromUrl: mocks.extract },
}));
vi.mock('../services/prisma-ai-settings-store', () => ({
  PrismaAiSettingsStore: class {
    resolveInternalUserId = async () => 'test-user';
    get = mocks.getSettings;
  },
}));
vi.mock('../services/credential-cipher', () => ({ createCredentialCipher: () => ({}) }));
vi.mock('../services/ai-credential-service', () => ({
  AiCredentialService: class {
    getCredentialSummary = mocks.getCredential;
  },
}));
vi.mock('../services/ai-batch-service', () => ({
  AiBatchService: class {
    create = mocks.createBatch;
  },
}));
vi.mock('../services/ai-task-queue', () => ({
  AiTaskQueue: class {
    enqueueBatch = mocks.enqueue;
  },
}));
vi.mock('../services/prisma-ai-task-store', () => ({
  PrismaAiTaskStore: class {
    findExistingKnowledgeItemIds = mocks.existingTasks;
  },
}));
vi.mock('../services/ai-provider-control-service', () => ({
  AiProviderControlService: class {
    isAllowed = async () => true;
  },
  PrismaAiProviderControlStore: class {},
}));
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  auditLog: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../config', () => ({
  config: {
    selfHosted: false,
    aiCredentialEncryption: { available: false },
    batchDefaults: { size: 3 },
    descriptionExtraction: { batchSize: 2, batchDelayMs: 0 },
    syncTimeBudget: { requestMs: 240_000, descriptionMs: 180_000, reserveForBaseSyncMs: 60_000 },
  },
}));
import router from './bookmarks';

const item = (id: string, description = '') => ({
  title: id,
  url: `https://example.com/${id}`,
  syncId: id,
  type: 'bookmark',
  description,
});
async function call(path: string, body: unknown) {
  const handler = router.stack
    .find((layer) => layer.route?.path === path)
    .route.stack.at(-1).handle;
  const req = { user: { userId: 'test-user' }, body } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  await handler(req, res, vi.fn());
  expect(res.json).toHaveBeenCalledOnce();
  return vi.mocked(res.json).mock.calls[0][0];
}

const sync = (
  items: unknown[],
  options: Record<string, unknown> = { generateDescriptions: false }
) => call('/sync', { items, options });
const enrichmentItem = (id: string, source = 'chrome_bookmark') => ({
  ...item(id),
  source,
  notionPageId: `page-${id}`,
  action: 'created',
});
const page = (description: string) => ({
  parent: { data_source_id: 'source' },
  properties: {
    Description: { id: 'description', type: 'rich_text', rich_text: [{ plain_text: description }] },
  },
});
function enableBatchAi() {
  mocks.findUser.mockResolvedValue({
    id: 'test-user',
    plan: 'pro',
    notionAccessToken: 'synthetic-token',
    notionDatabaseId: 'database',
    notionDataSourceId: 'source',
  });
  mocks.getSettings.mockResolvedValue({
    batchEnabled: true,
    properties: { descriptionPropertyId: 'description', tagsPropertyId: 'tags' },
  });
  mocks.getCredential.mockResolvedValue({ status: 'verified', provider: 'openai' });
  mocks.createBatch.mockImplementation(async (_user, _source, count) => ({
    id: 'batch',
    status: 'queued',
    eligibleCount: count,
  }));
  mocks.enqueue.mockImplementation(async ({ items }) => ({ created: items.length, skipped: 0 }));
  mocks.existingTasks.mockResolvedValue(new Set());
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clock = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => mocks.clock);
  mocks.findUser.mockResolvedValue({
    id: 'test-user',
    plan: 'free',
    notionAccessToken: 'synthetic-token',
    notionDatabaseId: 'database',
    notionDataSourceId: 'source',
  });
  mocks.notion.verifyDatabaseAccess.mockResolvedValue({
    databaseId: 'database',
    dataSourceId: 'source',
  });
  mocks.notion.existingBookmarkUrls.mockResolvedValue({ urls: [], syncIds: [], records: [] });
  mocks.notion.buildPropertiesFromDataSource.mockImplementation(
    async (_source, _token, value) => value
  );
  mocks.notion.createPage.mockImplementation(async (_parent, properties) => ({
    id: `page-${properties.syncId}`,
  }));
  mocks.notion.updatePage.mockResolvedValue({});
  mocks.extract.mockResolvedValue({ success: true, description: 'Extracted description' });
  mocks.notion.getAiTemplateProperties.mockResolvedValue({ descriptionPropertyId: 'description' });
  mocks.notion.getPage.mockResolvedValue(page('Saved description'));
});

afterEach(() => vi.restoreAllMocks());

describe('production bookmark sync', () => {
  it('deduplicates a created item appearing in a later description batch', async () => {
    const response = await sync([item('a'), item('b'), item('a')], {});
    expect(response.success).toBe(true);
    expect(mocks.notion.createPage).toHaveBeenCalledTimes(2);
    expect(response.results).toHaveLength(2);
  });

  it('keeps a described reading-list capture sharing a processed bookmark URL', async () => {
    mocks.extract.mockResolvedValue({ success: false });
    const response = await sync(
      [
        item('bookmark'),
        {
          ...item('reading-list', 'Existing summary'),
          url: item('bookmark').url,
          type: 'reading_list',
          readState: 'UNREAD',
        },
      ],
      {}
    );
    expect(mocks.notion.createPage).toHaveBeenCalledTimes(2);
    expect(response.results.map((result: { syncId: string }) => result.syncId)).toEqual([
      'bookmark',
      'reading-list',
    ]);
    expect(response.summary).toMatchObject({ success: 2, readingListSuccess: 1 });
  });

  it('preserves each capture and user description when same-URL extraction succeeds', async () => {
    const response = await sync(
      [
        item('bookmark'),
        {
          ...item('reading-list', 'User summary'),
          url: item('bookmark').url,
          type: 'reading_list',
          readState: 'UNREAD',
        },
      ],
      {}
    );
    const writtenItems = mocks.notion.buildPropertiesFromDataSource.mock.calls.map(
      ([, , value]) => value
    );
    expect(writtenItems).toEqual([
      expect.objectContaining({
        syncId: 'bookmark',
        type: 'bookmark',
        description: 'Extracted description',
      }),
      expect.objectContaining({
        syncId: 'reading-list',
        type: 'reading_list',
        description: 'User summary',
      }),
    ]);
    expect(response.summary).toMatchObject({
      success: 2,
      readingListTotal: 1,
      readingListSuccess: 1,
    });
  });

  it('writes an existing item with a newly extracted description only once', async () => {
    mocks.notion.existingBookmarkUrls.mockResolvedValue({
      urls: [item('a').url],
      syncIds: ['a'],
      records: [{ url: item('a').url, syncId: 'a', pageId: 'page-a' }],
    });
    const response = await sync([item('a')], {});
    expect(mocks.notion.updatePage).toHaveBeenCalledTimes(1);
    expect(response.summary).toMatchObject({ success: 1, updated: 1, failed: 0 });
  });

  it('bounds concurrent Notion creates and preserves an individual failure', async () => {
    let active = 0;
    let maximum = 0;
    mocks.notion.createPage.mockImplementation(async (_parent, properties) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active--;
      if (properties.syncId === 'd') throw new Error('synthetic invalid item');
      return { id: `page-${properties.syncId}` };
    });
    const response = await sync(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));
    expect(maximum).toBe(3);
    expect(response.summary).toMatchObject({ success: 4, failed: 1 });
    expect(
      response.results.find((result: { syncId: string }) => result.syncId === 'd')
    ).toMatchObject({ success: false });
  });

  it('returns applied results and deferred counts when the write deadline is reached', async () => {
    mocks.notion.createPage.mockImplementation(async (_parent, properties) => {
      mocks.clock = 241_000;
      return { id: `page-${properties.syncId}` };
    });
    const response = await sync(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));
    expect(response.success).toBe(true);
    expect(response.summary).toMatchObject({ success: 3, deferred: 2 });
    expect(response.partialSync).toMatchObject({
      applied: 3,
      requested: 5,
      processed: 3,
      skipped: 2,
    });
  });

  it('keeps successful base sync when optional AI planning rejects', async () => {
    mocks.getSettings.mockRejectedValue(new Error('synthetic AI settings failure'));
    const response = await sync([item('a')]);
    expect(response.success).toBe(true);
    expect(response.summary).toMatchObject({ success: 1, failed: 0 });
    expect(response.aiPlanning).toEqual({ status: 'failed' });
  });

  it('keeps inline eligibility based on every incoming capture', async () => {
    enableBatchAi();
    const response = await sync([
      { ...item('a'), source: 'chrome_bookmark' },
      { ...item('b'), source: 'context_menu' },
    ]);
    expect(response.aiPlanning).toEqual({ status: 'not_eligible' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('plans inline bulk AI once without a preliminary existing-task lookup', async () => {
    enableBatchAi();
    const response = await sync([{ ...item('a'), source: 'chrome_bookmark' }]);
    expect(response.aiPlanning).toEqual({ status: 'planned', taskCount: 1 });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.existingTasks).not.toHaveBeenCalled();
  });

  it('deduplicates deferred tasks and evaluates only eligible created items', async () => {
    enableBatchAi();
    mocks.existingTasks.mockResolvedValue(new Set(['a']));
    const response = await call('/enrich', {
      items: [
        enrichmentItem('a'),
        enrichmentItem('b'),
        { ...enrichmentItem('c', 'context_menu'), action: 'updated' },
      ],
    });
    expect(response.aiPlanning).toEqual({ status: 'planned', taskCount: 2 });
    expect(mocks.createBatch).toHaveBeenCalledExactlyOnceWith('test-user', 'source', 1);
    expect(
      mocks.enqueue.mock.calls[0][0].items.map(
        (value: { knowledgeItemId: string }) => value.knowledgeItemId
      )
    ).toEqual(['b']);
  });

  it('preserves a user description entered during the enrichment fetch', async () => {
    mocks.notion.getPage.mockResolvedValueOnce(page('')).mockResolvedValueOnce(page('User edit'));
    const response = await call('/enrich', { items: [enrichmentItem('a')] });
    expect(response.success).toBe(true);
    expect(response.summary).toMatchObject({ generated: 0, alreadyPresent: 1 });
    expect(mocks.notion.updatePage).not.toHaveBeenCalled();
  });
});
