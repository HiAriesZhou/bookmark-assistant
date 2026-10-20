import { describe, expect, it, vi } from 'vitest';
import { AiTaskQueue, type AiGenerationTaskRecord, type AiTaskStore } from './ai-task-queue';

function createStore(): AiTaskStore & { records: AiGenerationTaskRecord[] } {
  const records: AiGenerationTaskRecord[] = [];
  return {
    records,
    async resolveInternalUserId(userId) {
      return userId === 'missing' ? undefined : `internal-${userId}`;
    },
    async findTask(userId, knowledgeItemId) {
      return records.find(
        (record) => record.userId === userId && record.knowledgeItemId === knowledgeItemId
      );
    },
    async createTask(task) {
      const record = { ...task, id: `task-${records.length + 1}` };
      records.push(record);
      return record;
    },
    async createTasks(tasks) {
      let created = 0;
      for (const task of tasks) {
        if (
          records.some(
            (record) =>
              record.userId === task.userId && record.knowledgeItemId === task.knowledgeItemId
          )
        )
          continue;
        records.push({ ...task, id: `task-${records.length + 1}` });
        created++;
      }
      return created;
    },
  };
}

describe('AiTaskQueue', () => {
  it('captures provider, model, credential version and a description baseline without page body', async () => {
    const store = createStore();
    const credentials = {
      getCredentialSummary: async () => ({
        provider: 'openai' as const,
        status: 'verified' as const,
        keyLastFour: '1234',
        credentialVersion: 3,
        verifiedAt: new Date(),
      }),
    };
    const queue = new AiTaskQueue(store, credentials);

    const result = await queue.enqueue({
      externalUserId: 'user-a',
      knowledgeItemId: 'ki-1',
      notionPageId: 'page-1',
      sourceUrl: 'https://example.com/path?secret=not-in-body',
      descriptionBaselineHash: 'baseline-hash',
      mode: 'single_page',
    });

    expect(result).toMatchObject({
      created: true,
      task: {
        status: 'queued',
        provider: 'openai',
        model: 'gpt-5-mini',
        credentialVersion: 3,
        descriptionBaselineHash: 'baseline-hash',
      },
    });
    expect(store.records[0]).not.toHaveProperty('body');
  });

  it('returns an existing task instead of duplicating generation', async () => {
    const store = createStore();
    const queue = new AiTaskQueue(store, {
      getCredentialSummary: async () => ({
        provider: 'gemini' as const,
        status: 'verified' as const,
        keyLastFour: '1234',
        credentialVersion: 1,
        verifiedAt: null,
      }),
    });
    const input = {
      externalUserId: 'user-a',
      knowledgeItemId: 'ki-1',
      notionPageId: 'page-1',
      mode: 'batch' as const,
    };

    await queue.enqueue(input);
    await expect(queue.enqueue(input)).resolves.toMatchObject({
      created: false,
      task: { id: 'task-1' },
    });
    expect(store.records).toHaveLength(1);
  });

  it('does not create tasks before a verified credential exists', async () => {
    const store = createStore();
    const queue = new AiTaskQueue(store, { getCredentialSummary: async () => undefined });

    await expect(
      queue.enqueue({
        externalUserId: 'user-a',
        knowledgeItemId: 'ki-1',
        notionPageId: 'page-1',
        mode: 'batch',
      })
    ).resolves.toEqual({
      created: false,
      reason: 'credential_required',
    });
    expect(store.records).toHaveLength(0);
  });

  it('persists a large batch in one store operation and ignores duplicate work', async () => {
    const store = createStore();
    const createTasks = vi.spyOn(store, 'createTasks');
    const queue = new AiTaskQueue(store, {
      getCredentialSummary: async () => ({
        provider: 'openai' as const,
        status: 'verified' as const,
        keyLastFour: '1234',
        credentialVersion: 1,
        verifiedAt: null,
      }),
    });

    await expect(
      queue.enqueueBatch({
        externalUserId: 'user-a',
        batchId: 'batch-1',
        initialStatus: 'queued',
        items: [
          { knowledgeItemId: 'ki-1', notionPageId: 'page-1', sourceUrl: 'https://one.example' },
          { knowledgeItemId: 'ki-2', notionPageId: 'page-2', sourceUrl: 'https://two.example' },
        ],
      })
    ).resolves.toEqual({ created: 2, skipped: 0 });
    await expect(
      queue.enqueueBatch({
        externalUserId: 'user-a',
        batchId: 'batch-1',
        initialStatus: 'queued',
        items: [{ knowledgeItemId: 'ki-1', notionPageId: 'page-1' }],
      })
    ).resolves.toEqual({ created: 0, skipped: 1 });
    expect(createTasks).toHaveBeenCalledTimes(2);
    expect(store.records).toHaveLength(2);
  });
});
