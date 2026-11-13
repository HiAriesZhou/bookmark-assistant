import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTaskRuntime,
  type TaskDefinition,
  type TaskRecord,
  type TaskStore,
} from '../runtime';
import {
  NOTION_SYNC_TASK_KEY,
  reconcileSyncProgress,
  registerNotionSyncTask,
  submitNotionSync,
} from './notion-runtime';

const storage = new Map<string, unknown>();
const api = vi.hoisted(() => ({ createPage: vi.fn(), assertCurrent: vi.fn() }));
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: storage.get(key) }),
      set: async (values: Record<string, unknown>) =>
        Object.entries(values).forEach(([key, value]) => storage.set(key, value)),
      remove: async () => undefined,
    },
  },
});
vi.mock('../utils/destination-state', () => ({
  readDestinationContext: async () => ({ revision: 'r1', token: 'token', databaseId: 'db' }),
  assertDestinationContextCurrent: api.assertCurrent,
  isDestinationContextCurrent: async () => true,
  withCurrentDestination: async (_context: unknown, action: () => Promise<unknown>) => action(),
}));
vi.mock('../destinations/notion/notion-api', () => ({
  notionApi: {
    verifyDatabaseAccess: async () => ({ databaseId: 'db', dataSourceId: 'ds' }),
    existingLinksPage: async () => ({ records: [], urls: [], syncIds: [], describedPageIds: [] }),
    buildPropertiesFromDataSource: async () => ({}),
    createPage: api.createPage,
    updatePage: async () => undefined,
    findPageBySyncId: async () => undefined,
    findPageByUrlAndType: async () => undefined,
    readDescription: async () => ({ property: 'Description', text: '' }),
    writeDescription: async () => undefined,
  },
}));
vi.mock('./link-description', () => ({
  enrichLinkDescriptions: async (links: unknown[]) => links,
}));
vi.mock('./connection-health', () => ({ recordConnectionFailure: async () => undefined }));

const context = { revision: 'r1', token: 'token', databaseId: 'db' };
const link = (title: string) => ({ title, url: `https://${title}.example`, syncId: title });
function fixture(maxSteps = 20) {
  const records = new Map<string, TaskRecord>();
  const store: TaskStore = {
    get: async (id) => records.get(id),
    list: async () => [...records.values()],
    update: async (id, change) => {
      const next = change(records.get(id));
      if (next) records.set(id, next);
      return next;
    },
  };
  let clock = Date.now();
  const runtime = createTaskRuntime({ store, maxSteps, now: () => clock++ });
  const registration = vi.spyOn(runtime, 'register');
  registerNotionSyncTask(runtime);
  const definition = registration.mock.calls[0][1] as TaskDefinition<unknown, unknown>;
  return { runtime, store, records, settle: definition.onSettled! };
}

beforeEach(() => {
  storage.clear();
  api.createPage.mockReset().mockResolvedValue({ id: 'page-1' });
  api.assertCurrent.mockReset().mockResolvedValue(undefined);
});

describe('durable Notion task submission', () => {
  it('returns immediately and resumes on a replacement runtime', async () => {
    const first = fixture(1);
    const id = await submitNotionSync(first.runtime, context, {
      links: [link('a')],
      trigger: 'manual',
    });
    expect(storage.get('sync_in_progress')).toBe(true);
    const replacement = createTaskRuntime({ store: first.store, maxSteps: 20 });
    registerNotionSyncTask(replacement);
    await replacement.runner();
    expect(first.records.get(id)?.status).toBe('succeeded');
    expect(storage.get('sync_in_progress')).toBe(false);
  });

  it('clears an in-progress marker that has no durable sync task behind it', async () => {
    // 升级前的同步留下 sync_in_progress=true，而新任务库为空；不清理会永久禁用同步按钮。
    const { runtime } = fixture();
    storage.set('sync_in_progress', true);
    storage.set('sync_started_at', 1);
    storage.set('sync_trigger', 'auto');
    await reconcileSyncProgress(runtime);
    expect(storage.get('sync_in_progress')).toBe(false);
    expect(storage.get('sync_started_at')).toBeNull();
    expect(storage.get('sync_trigger')).toBeNull();
  });

  it('keeps the in-progress marker while a sync task is still pending', async () => {
    const { runtime } = fixture();
    await submitNotionSync(runtime, context, { links: [link('a')], trigger: 'manual' });
    await reconcileSyncProgress(runtime);
    expect(storage.get('sync_in_progress')).toBe(true);
  });

  it('replans definitely rejected writes with the newly collected bookmarks', async () => {
    const { runtime, records } = fixture();
    api.createPage.mockRejectedValueOnce(Object.assign(new Error('validation'), { status: 400 }));
    const oldId = await submitNotionSync(runtime, context, {
      links: [link('invalid')],
      trigger: 'manual',
    });
    await runtime.runner();
    expect(records.get(oldId)?.errorCode).toBe('notion_request_rejected');
    const newId = await submitNotionSync(runtime, context, {
      links: [link('corrected'), link('new')],
      trigger: 'manual',
    });
    expect(newId).not.toBe(oldId);
    expect(records.get(newId)?.input).toMatchObject({ links: [link('corrected'), link('new')] });
    await runtime.runner();
    expect(records.get(newId)?.status).toBe('succeeded');
  });

  it('does not bypass an uncertain capture by submitting the same URL again', async () => {
    const { runtime, records } = fixture();
    const input = { links: [link('capture')], trigger: 'manual' as const, capture: true };
    const id = await submitNotionSync(runtime, context, input);
    records.set(id, { ...records.get(id)!, status: 'failed', errorCode: 'notion_write_uncertain' });
    await expect(submitNotionSync(runtime, context, input)).rejects.toThrow('unknown result');
    expect(records.size).toBe(1);
  });

  it('ignores a terminal callback queued before the same task was retried', async () => {
    const { runtime, records, settle } = fixture();
    const input = { links: [link('a')], trigger: 'manual' as const };
    const id = await submitNotionSync(runtime, context, input);
    const failed: TaskRecord = {
      ...records.get(id)!,
      status: 'failed',
      settled: false,
      errorCode: 'notion_request_failed',
      version: 1,
    };
    records.set(id, failed);
    let unblock!: () => void;
    let entered!: () => void;
    const enteredLock = new Promise<void>((resolve) => {
      entered = resolve;
    });
    api.assertCurrent.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => {
        unblock = resolve;
      });
    });
    const retrying = submitNotionSync(runtime, context, input);
    await enteredLock;
    const outdatedSettlement = settle(failed);
    unblock();
    await retrying;
    await outdatedSettlement;
    expect(records.get(id)?.status).toBe('pending');
    expect(storage.get('last_sync_error')).toBeNull();
    expect(storage.get('dashboard_last_sync')).toBeUndefined();
  });

  it('keeps the library state while a shorter capture completes and records later library failure', async () => {
    const { runtime, records } = fixture(1);
    const libraryId = await submitNotionSync(runtime, context, {
      links: ['a', 'b', 'c', 'd'].map(link),
      trigger: 'manual',
    });
    const captureId = await submitNotionSync(runtime, context, {
      links: [link('capture')],
      trigger: 'manual',
      capture: true,
    });
    for (let step = 0; step < 30 && records.get(captureId)?.status !== 'succeeded'; step++)
      await runtime.runner();
    expect(records.get(captureId)?.status).toBe('succeeded');
    expect(records.get(libraryId)?.status).toBe('pending');
    expect(storage.get(NOTION_SYNC_TASK_KEY)).toBe(libraryId);
    expect(storage.get('sync_in_progress')).toBe(true);
    api.createPage.mockRejectedValue(Object.assign(new Error('validation'), { status: 400 }));
    for (let step = 0; step < 10 && records.get(libraryId)?.status !== 'failed'; step++)
      await runtime.runner();
    expect(records.get(libraryId)?.status).toBe('failed');
    expect(storage.get('sync_in_progress')).toBe(false);
    expect(storage.get('dashboard_last_sync')).toMatchObject({
      total: 4,
      result: 'partial_failure',
    });
    expect(storage.get('last_sync_error')).toBeTruthy();
  });
});
