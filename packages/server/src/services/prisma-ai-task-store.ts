import type { Prisma } from '@prisma/client';
import type { AiGenerationReasonCode, AiGenerationStatus } from '@bookmark-assistant/types';
import type { ExecutableAiTask } from './ai-task-executor';
import type { AiGenerationTaskRecord, AiTaskStore } from './ai-task-queue';
import { AI_GENERATION_PROMPT_VERSION } from './ai-generation-prompt';
import { prisma, userPrisma } from './userPrisma';

const taskSelect = {
  id: true,
  userId: true,
  knowledgeItemId: true,
  notionPageId: true,
  batchId: true,
  sourceUrl: true,
  mode: true,
  status: true,
  provider: true,
  model: true,
  promptVersion: true,
  credentialVersion: true,
  descriptionBaselineHash: true,
  leaseToken: true,
  attemptCount: true,
  nextAttemptAt: true,
  createdAt: true,
} as const;

function providerPausedBatchWhere(provider: string): Prisma.AiGenerationTaskWhereInput {
  return {
    provider,
    status: 'service_unavailable',
    reasonCode: 'service_provider_paused',
  };
}

function metadataFallbackBatchWhere(provider: string): Prisma.AiGenerationTaskWhereInput {
  return {
    provider,
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
  };
}

export class PrismaAiTaskStore implements AiTaskStore {
  resolveInternalUserId(externalUserId: string): Promise<string | undefined> {
    return userPrisma.resolveInternalUserId(externalUserId);
  }

  async findTask(
    userId: string,
    knowledgeItemId: string
  ): Promise<AiGenerationTaskRecord | undefined> {
    const task = await prisma.aiGenerationTask.findUnique({
      where: { userId_knowledgeItemId: { userId, knowledgeItemId } },
      select: taskSelect,
    });
    return task ? toTaskRecord(task) : undefined;
  }

  async createTask(task: Omit<AiGenerationTaskRecord, 'id'>): Promise<AiGenerationTaskRecord> {
    const created = await prisma.aiGenerationTask.create({ data: task, select: taskSelect });
    return toTaskRecord(created);
  }

  async createTasks(tasks: Array<Omit<AiGenerationTaskRecord, 'id'>>): Promise<number> {
    if (!tasks.length) return 0;
    const created = await prisma.aiGenerationTask.createMany({
      data: tasks,
      skipDuplicates: true,
    });
    return created.count;
  }

  async findExistingKnowledgeItemIds(
    userId: string,
    knowledgeItemIds: string[]
  ): Promise<Set<string>> {
    if (!knowledgeItemIds.length) return new Set();
    const tasks = await prisma.aiGenerationTask.findMany({
      where: { userId, knowledgeItemId: { in: knowledgeItemIds } },
      select: { knowledgeItemId: true },
    });
    return new Set(tasks.map((task) => task.knowledgeItemId));
  }

  /** Claims a queued or expired-lease task using a compare-and-set update. */
  async claimTask(
    taskId: string,
    leaseToken: string,
    leaseDurationMs = 120_000
  ): Promise<ExecutableAiTask | undefined> {
    return this.claimWithUserSlot(taskId, leaseToken, leaseDurationMs, false);
  }

  /** Claims the one in-request retry allowed for transient single-page failures. */
  async claimSinglePageRetry(
    taskId: string,
    leaseToken: string,
    leaseDurationMs = 120_000
  ): Promise<ExecutableAiTask | undefined> {
    return this.claimWithUserSlot(taskId, leaseToken, leaseDurationMs, true);
  }

  /** Removes a never-started single-page task when no in-memory execution slot was available. */
  async deleteUnclaimedSinglePageTask(taskId: string): Promise<boolean> {
    const deleted = await prisma.aiGenerationTask.deleteMany({
      where: { id: taskId, mode: 'single_page', status: 'queued', attemptCount: 0 },
    });
    return deleted.count === 1;
  }

  async complete(
    taskId: string,
    leaseToken: string,
    status: AiGenerationStatus,
    reasonCode?: AiGenerationReasonCode
  ): Promise<boolean> {
    const result = await prisma.aiGenerationTask.updateMany({
      where: { id: taskId, status: 'processing', leaseToken },
      data: {
        status,
        reasonCode: reasonCode || null,
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    return result.count === 1;
  }

  async hasActiveLease(taskId: string, leaseToken: string): Promise<boolean> {
    const task = await prisma.aiGenerationTask.findFirst({
      where: { id: taskId, status: 'processing', leaseToken, leaseExpiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return !!task;
  }

  async setBatchTaskStatus(batchId: string, status: AiGenerationStatus): Promise<void> {
    await prisma.aiGenerationTask.updateMany({
      where: { batchId, status: 'awaiting_confirmation' },
      data: {
        status,
        reasonCode: status === 'skipped' ? 'skipped_target_unavailable' : null,
        completedAt: status === 'skipped' ? new Date() : null,
      },
    });
  }

  async listClaimable(limit = 100): Promise<Array<ExecutableAiTask & { createdAt: Date }>> {
    const tasks = await prisma.aiGenerationTask.findMany({
      where: claimableTaskWhere(),
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: taskSelect,
    });
    return tasks.map((task) => toTaskRecord(task) as ExecutableAiTask & { createdAt: Date });
  }

  async listClaimableForUser(
    userId: string,
    limit = 20
  ): Promise<Array<ExecutableAiTask & { createdAt: Date }>> {
    const tasks = await prisma.aiGenerationTask.findMany({
      where: { userId, mode: 'batch', ...claimableTaskWhere() },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: taskSelect,
    });
    return tasks.map((task) => toTaskRecord(task) as ExecutableAiTask & { createdAt: Date });
  }

  async countClaimableForUser(userId: string): Promise<number> {
    return prisma.aiGenerationTask.count({
      where: {
        userId,
        mode: 'batch',
        OR: [{ status: 'queued' }, { status: 'processing', leaseExpiresAt: { lt: new Date() } }],
      },
    });
  }

  async getBatchExecutionSummary(
    userId: string,
    provider?: string,
    dataSourceId?: string | null
  ): Promise<{
    ready: number;
    retryable: number;
    scheduled: number;
    processing: number;
    blocked: number;
  }> {
    const currentTarget: Prisma.AiGenerationTaskWhereInput = dataSourceId
      ? {
          OR: [
            { batchId: null },
            { batch: { is: { OR: [{ dataSourceId: null }, { dataSourceId }] } } },
          ],
        }
      : {};
    const base: Prisma.AiGenerationTaskWhereInput = {
      userId,
      mode: 'batch',
    };
    const now = new Date();
    const retryable: Prisma.AiGenerationTaskWhereInput = provider
      ? {
          OR: [providerPausedBatchWhere(provider), metadataFallbackBatchWhere(provider)],
        }
      : { id: { in: [] } };

    const [readyCount, retryableCount, scheduledCount, processingCount, blockedCount] =
      await Promise.all([
        prisma.aiGenerationTask.count({
          where: {
            ...base,
            AND: [
              currentTarget,
              {
                OR: [{ status: 'awaiting_confirmation' }, claimableTaskWhere(now)],
              },
            ],
          },
        }),
        prisma.aiGenerationTask.count({
          where: { ...base, AND: [currentTarget, retryable] },
        }),
        prisma.aiGenerationTask.count({
          where: {
            ...base,
            AND: [currentTarget, { status: 'queued', nextAttemptAt: { gt: now } }],
          },
        }),
        prisma.aiGenerationTask.count({
          where: {
            ...base,
            AND: [currentTarget, { status: 'processing', leaseExpiresAt: { gte: now } }],
          },
        }),
        prisma.aiGenerationTask.count({
          where: { ...base, AND: [currentTarget, { status: 'needs_action' }] },
        }),
      ]);
    return {
      ready: readyCount,
      retryable: retryableCount,
      scheduled: scheduledCount,
      processing: processingCount,
      blocked: blockedCount,
    };
  }

  async countProcessingByUser(): Promise<Map<string, number>> {
    const rows = await prisma.aiGenerationTask.groupBy({
      by: ['userId'],
      where: { status: 'processing', leaseExpiresAt: { gt: new Date() } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.userId, row._count._all]));
  }

  /** Removes queued work belonging to a previously connected Notion data source. */
  async skipTasksOutsideDataSource(userId: string, dataSourceId: string): Promise<number> {
    const result = await prisma.aiGenerationTask.updateMany({
      where: {
        userId,
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
        batch: { is: { dataSourceId: { not: null }, NOT: { dataSourceId } } },
      },
      data: {
        status: 'skipped',
        reasonCode: 'skipped_target_unavailable',
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    return result.count;
  }

  async retryBatchTask(taskId: string, retryAfterMs = 1_000): Promise<boolean> {
    const result = await prisma.aiGenerationTask.updateMany({
      where: {
        id: taskId,
        mode: 'batch',
        status: 'failed',
        reasonCode: 'failed_provider_request',
        attemptCount: { lt: 3 },
      },
      data: {
        status: 'queued',
        reasonCode: null,
        completedAt: null,
        nextAttemptAt: new Date(Date.now() + Math.min(Math.max(retryAfterMs, 1_000), 15 * 60_000)),
      },
    });
    return result.count === 1;
  }

  async resumeProviderTasks(
    userId: string,
    provider: string,
    mode: 'single_page' | 'batch'
  ): Promise<number> {
    const result = await prisma.aiGenerationTask.updateMany({
      where: {
        userId,
        mode,
        ...providerPausedBatchWhere(provider),
      },
      data: {
        status: 'queued',
        reasonCode: null,
        completedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    return result.count;
  }

  /** Requeues tasks skipped before metadata fallback was applied. No model output was written. */
  async resumeMetadataFallbackTasks(
    userId: string,
    provider: string,
    mode: 'batch'
  ): Promise<number> {
    const result = await prisma.aiGenerationTask.updateMany({
      where: {
        userId,
        mode,
        ...metadataFallbackBatchWhere(provider),
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
    return result.count;
  }

  async markNeedsAction(taskId: string, leaseToken: string): Promise<void> {
    await this.complete(taskId, leaseToken, 'needs_action', 'needs_action_notion_authorization');
  }

  async stopUserTasksForProviderError(
    userId: string,
    provider: string,
    credentialVersion: number,
    reasonCode: Extract<
      AiGenerationReasonCode,
      | 'needs_action_invalid_api_key'
      | 'needs_action_insufficient_quota'
      | 'needs_action_model_access'
    >
  ): Promise<void> {
    await prisma.$transaction([
      prisma.aiProviderCredential.updateMany({
        where: { userId, provider, credentialVersion, status: 'verified' },
        data: { status: 'invalid' },
      }),
      prisma.aiGenerationTask.updateMany({
        where: {
          userId,
          provider,
          credentialVersion,
          status: {
            in: ['awaiting_confirmation', 'queued', 'processing', 'paused', 'service_unavailable'],
          },
        },
        data: {
          status: 'needs_action',
          reasonCode,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      }),
    ]);
  }

  async recent(
    userId: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      status: string;
      reasonCode: string | null;
      mode: string;
      createdAt: Date;
      completedAt: Date | null;
    }>
  > {
    return prisma.aiGenerationTask.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 20),
      select: {
        id: true,
        status: true,
        reasonCode: true,
        mode: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }

  private async claimWithUserSlot(
    taskId: string,
    leaseToken: string,
    leaseDurationMs: number,
    singlePageRetry: boolean
  ): Promise<ExecutableAiTask | undefined> {
    const candidate = await prisma.aiGenerationTask.findUnique({
      where: { id: taskId },
      select: { userId: true },
    });
    if (!candidate) return undefined;

    return prisma.$transaction(async (transaction) => {
      // The transaction-scoped advisory lock makes the user-level capacity check and
      // task claim one atomic operation across concurrent Vercel instances.
      // pg_advisory_xact_lock returns PostgreSQL `void`. $queryRaw tries to
      // deserialize result columns and fails on that type; this statement only
      // needs its transaction-scoped side effect.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bookmark-assistant-ai'), hashtext(${candidate.userId}))`;
      const now = new Date();
      const active = await transaction.aiGenerationTask.count({
        where: { userId: candidate.userId, status: 'processing', leaseExpiresAt: { gt: now } },
      });
      if (active >= 2) return undefined;

      const eligibility = singlePageRetry
        ? {
            mode: 'single_page',
            status: 'failed',
            reasonCode: 'failed_provider_request',
            attemptCount: { lt: 2 },
          }
        : {
            OR: [
              { status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
              { status: 'processing', leaseExpiresAt: { lt: now } },
            ],
          };
      const claimed = await transaction.aiGenerationTask.updateMany({
        where: { id: taskId, ...eligibility },
        data: {
          status: 'processing',
          reasonCode: null,
          completedAt: null,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
          nextAttemptAt: null,
          startedAt: now,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return undefined;
      const task = await transaction.aiGenerationTask.findFirst({
        where: { id: taskId, status: 'processing', leaseToken },
        select: taskSelect,
      });
      return task ? (toTaskRecord(task) as ExecutableAiTask) : undefined;
    });
  }
}

function claimableTaskWhere(now = new Date()): Prisma.AiGenerationTaskWhereInput {
  return {
    OR: [
      { status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { status: 'processing', leaseExpiresAt: { lt: now } },
    ],
  };
}

function toTaskRecord(task: {
  id: string;
  userId: string;
  knowledgeItemId: string;
  notionPageId: string;
  batchId?: string | null;
  sourceUrl: string | null;
  mode: string;
  status: string;
  provider: string;
  model: string;
  promptVersion: string;
  credentialVersion: number;
  descriptionBaselineHash?: string | null;
  leaseToken?: string | null;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  createdAt?: Date;
}): AiGenerationTaskRecord {
  return task as AiGenerationTaskRecord;
}
