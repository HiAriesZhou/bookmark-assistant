import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const task = {
    id: 'task-1',
    userId: 'user-1',
    knowledgeItemId: 'ki-1',
    notionPageId: 'page-1',
    batchId: null,
    sourceUrl: 'https://example.com',
    mode: 'batch',
    status: 'processing',
    provider: 'openai',
    model: 'gpt-5-mini',
    promptVersion: 'v1',
    credentialVersion: 3,
    descriptionBaselineHash: null,
    leaseToken: 'lease-1',
    attemptCount: 1,
    nextAttemptAt: null,
    createdAt: new Date('2026-08-24T00:00:00Z'),
  };
  const transaction = {
    $executeRaw: vi.fn(async () => 0),
    aiGenerationTask: {
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => task),
    },
  };
  const prisma = {
    aiGenerationTask: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => ({ userId: 'user-1' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    aiProviderCredential: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (input: unknown) => {
      if (typeof input === 'function')
        return (input as (value: typeof transaction) => unknown)(transaction);
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  return { prisma, task, transaction };
});

vi.mock('./userPrisma', () => ({
  prisma: mocks.prisma,
  userPrisma: { resolveInternalUserId: vi.fn(async (value: string) => value) },
}));

import { PrismaAiTaskStore } from './prisma-ai-task-store';
import { AI_GENERATION_PROMPT_VERSION } from './ai-generation-prompt';

describe('PrismaAiTaskStore safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiGenerationTask.findUnique.mockResolvedValue({ userId: 'user-1' });
    mocks.transaction.aiGenerationTask.count.mockResolvedValue(0);
    mocks.transaction.aiGenerationTask.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.aiGenerationTask.findFirst.mockResolvedValue(mocks.task);
  });

  it('takes the user advisory lock before reserving a provider request slot', async () => {
    await expect(new PrismaAiTaskStore().claimTask('task-1', 'lease-1')).resolves.toMatchObject({
      id: 'task-1',
    });
    expect(mocks.transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transaction.aiGenerationTask.count.mock.invocationCallOrder[0]
    );
    expect(mocks.transaction.aiGenerationTask.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not claim a third active provider request for the same user', async () => {
    mocks.transaction.aiGenerationTask.count.mockResolvedValue(2);
    await expect(new PrismaAiTaskStore().claimTask('task-1', 'lease-1')).resolves.toBeUndefined();
    expect(mocks.transaction.aiGenerationTask.updateMany).not.toHaveBeenCalled();
  });

  it('separates ready, recoverable, active, and blocked batch work', async () => {
    mocks.prisma.aiGenerationTask.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);

    await expect(
      new PrismaAiTaskStore().getBatchExecutionSummary('user-1', 'openai', 'source-1')
    ).resolves.toEqual({ ready: 2, retryable: 1, scheduled: 4, processing: 1, blocked: 3 });
    expect(mocks.prisma.aiGenerationTask.count).toHaveBeenCalledTimes(5);
    expect(mocks.prisma.aiGenerationTask.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { status: 'awaiting_confirmation' },
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    status: 'queued',
                    OR: expect.arrayContaining([expect.objectContaining({ nextAttemptAt: null })]),
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
    });
    expect(mocks.prisma.aiGenerationTask.count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        userId: 'user-1',
        mode: 'batch',
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { batchId: null },
              { batch: { is: { OR: [{ dataSourceId: null }, { dataSourceId: 'source-1' }] } } },
            ]),
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([expect.objectContaining({ provider: 'openai' })]),
          }),
        ]),
      }),
    });
  });

  it('invalidates only the credential version that caused a terminal provider error', async () => {
    await new PrismaAiTaskStore().stopUserTasksForProviderError(
      'user-1',
      'openai',
      3,
      'needs_action_invalid_api_key'
    );
    expect(mocks.prisma.aiProviderCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', provider: 'openai', credentialVersion: 3, status: 'verified' },
      })
    );
    expect(mocks.prisma.aiGenerationTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          provider: 'openai',
          credentialVersion: 3,
        }),
      })
    );
  });

  it('removes a single-page task that never acquired an in-memory execution slot', async () => {
    await expect(new PrismaAiTaskStore().deleteUnclaimedSinglePageTask('task-1')).resolves.toBe(
      true
    );
    expect(mocks.prisma.aiGenerationTask.deleteMany).toHaveBeenCalledWith({
      where: { id: 'task-1', mode: 'single_page', status: 'queued', attemptCount: 0 },
    });
  });

  it('bulk-skips queued tasks from a previously connected Notion data source', async () => {
    await expect(
      new PrismaAiTaskStore().skipTasksOutsideDataSource('user-1', 'current-source')
    ).resolves.toBe(1);
    expect(mocks.prisma.aiGenerationTask.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        mode: 'batch',
        status: {
          in: [
            'awaiting_confirmation',
            'queued',
            'processing',
            'paused',
            'service_unavailable',
            'needs_action',
          ],
        },
        batch: { is: { dataSourceId: { not: null }, NOT: { dataSourceId: 'current-source' } } },
      },
      data: {
        status: 'skipped',
        reasonCode: 'skipped_target_unavailable',
        completedAt: expect.any(Date),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
  });

  it('requeues prompt-version recoverable metadata and Notion write failures once', async () => {
    await expect(
      new PrismaAiTaskStore().resumeMetadataFallbackTasks('user-1', 'openai', 'batch')
    ).resolves.toBe(1);
    expect(mocks.prisma.aiGenerationTask.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: 'openai',
        mode: 'batch',
        OR: [
          {
            status: 'skipped',
            reasonCode: {
              in: [
                'skipped_fetch_disallowed',
                'skipped_unsupported_content_type',
                'skipped_insufficient_content',
              ],
            },
          },
          { status: 'failed', reasonCode: 'failed_notion_write' },
        ],
        promptVersion: { not: AI_GENERATION_PROMPT_VERSION },
      },
      data: {
        status: 'queued',
        reasonCode: null,
        promptVersion: AI_GENERATION_PROMPT_VERSION,
        completedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
  });
});
