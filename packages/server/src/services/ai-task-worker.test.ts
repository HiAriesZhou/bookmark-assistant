import { describe, expect, it, vi } from 'vitest';
import { AiTaskWorker } from './ai-task-worker';

const task = (id: string, userId: string, minute: number) => ({
  id,
  userId,
  knowledgeItemId: id,
  notionPageId: id,
  sourceUrl: 'https://example.com',
  mode: 'batch' as const,
  status: 'queued' as const,
  provider: 'openai',
  model: 'gpt-5-mini',
  promptVersion: 'v1',
  credentialVersion: 1,
  createdAt: new Date(`2026-08-23T00:${String(minute).padStart(2, '0')}:00Z`),
});

describe('AiTaskWorker', () => {
  it('claims fairly selected tasks and resolves context before execution', async () => {
    const queued = [task('a1', 'a', 1), task('a2', 'a', 2), task('b1', 'b', 3)];
    const execute = vi.fn(async () => undefined);
    const worker = new AiTaskWorker({
      store: {
        listClaimable: async () => queued,
        listClaimableForUser: async () => queued,
        countProcessingByUser: async () => new Map(),
        claimTask: async (id) => queued.find((item) => item.id === id),
        retryBatchTask: async () => false,
        markNeedsAction: async () => undefined,
      },
      resolveContext: async () => ({
        accessToken: 'token',
        settings: { descriptionPropertyId: 'desc', tagsPropertyId: 'tags' },
      }),
      execute: execute as any,
    });
    await expect(worker.runOnce(2)).resolves.toBe(2);
    expect(execute.mock.calls.map(([item]) => item.id)).toEqual(['a1', 'b1']);
  });

  it('runs only the requested user tasks and preserves the two-request limit', async () => {
    const queued = [task('a1', 'a', 1), task('a2', 'a', 2), task('b1', 'b', 3)];
    const execute = vi.fn(async () => 'succeeded');
    const worker = new AiTaskWorker({
      store: {
        listClaimable: async () => queued,
        listClaimableForUser: async (userId) => queued.filter((item) => item.userId === userId),
        countProcessingByUser: async () => new Map(),
        claimTask: async (id) => queued.find((item) => item.id === id),
        retryBatchTask: async () => false,
        markNeedsAction: async () => undefined,
      },
      resolveContext: async () => ({
        accessToken: 'token',
        settings: { descriptionPropertyId: 'desc', tagsPropertyId: 'tags' },
      }),
      execute: execute as any,
    });
    await expect(worker.runForUser('a', 10)).resolves.toBe(2);
    expect(execute.mock.calls.map(([item]) => item.id)).toEqual(['a1', 'a2']);
  });

  it('uses provider retry timing before exponential backoff', async () => {
    const queued = [{ ...task('a1', 'a', 1), attemptCount: 2, providerRetryAfterMs: 12_000 }];
    const retryBatchTask = vi.fn(async () => true);
    const worker = new AiTaskWorker({
      store: {
        listClaimable: async () => queued,
        listClaimableForUser: async () => queued,
        countProcessingByUser: async () => new Map(),
        claimTask: async () => queued[0],
        retryBatchTask,
        markNeedsAction: async () => undefined,
      },
      resolveContext: async () => ({
        accessToken: 'token',
        settings: { descriptionPropertyId: 'desc', tagsPropertyId: 'tags' },
      }),
      execute: async () => 'failed',
    });
    await worker.runForUser('a', 1);
    expect(retryBatchTask).toHaveBeenCalledWith('a1', 12_000);
  });
});
