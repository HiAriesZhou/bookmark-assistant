import { randomUUID } from 'crypto';
import type { ExecutableAiTask } from './ai-task-executor';
import type { AiGenerationStatus } from '@bookmark-assistant/types';
import { selectFairAiTasks } from './ai-task-scheduler';

export interface AiTaskWorkerStore {
  listClaimable(limit: number): Promise<Array<ExecutableAiTask & { createdAt: Date }>>;
  listClaimableForUser(userId: string, limit: number): Promise<Array<ExecutableAiTask & { createdAt: Date }>>;
  countProcessingByUser(): Promise<Map<string, number>>;
  claimTask(id: string, leaseToken: string): Promise<ExecutableAiTask | undefined>;
  retryBatchTask(id: string, retryAfterMs?: number): Promise<boolean>;
  markNeedsAction(id: string, leaseToken: string): Promise<void>;
}

export interface AiTaskWorkerDependencies {
  store: AiTaskWorkerStore;
  resolveContext(userId: string): Promise<{ accessToken: string; settings: { descriptionPropertyId: string; tagsPropertyId: string }; dataSourceId?: string } | undefined>;
  execute(task: ExecutableAiTask, context: { accessToken: string; settings: { descriptionPropertyId: string; tagsPropertyId: string }; dataSourceId?: string }): Promise<AiGenerationStatus>;
}

export type AiTaskRunSummary = {
  claimed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  needsAction: number;
};

/** One safe worker pass. It can be invoked by an authenticated client or a future queue consumer. */
export class AiTaskWorker {
  constructor(private readonly dependencies: AiTaskWorkerDependencies) {}

  async runOnce(maxTasks = 20): Promise<number> {
    const [queued, active] = await Promise.all([
      this.dependencies.store.listClaimable(Math.max(maxTasks * 4, maxTasks)),
      this.dependencies.store.countProcessingByUser(),
    ]);
    const selected = selectFairAiTasks(queued, active, maxTasks);
    return this.runSelected(selected);
  }

  /** Runs a small, user-owned batch without allowing one user to exceed two active requests. */
  async runForUser(userId: string, maxTasks = 2): Promise<number> {
    return (await this.runForUserWithSummary(userId, maxTasks)).claimed;
  }

  /** Returns final execution states so callers do not confuse a claim with a write. */
  async runForUserWithSummary(userId: string, maxTasks = 2): Promise<AiTaskRunSummary> {
    const active = await this.dependencies.store.countProcessingByUser();
    const remainingSlots = Math.max(0, 2 - (active.get(userId) || 0));
    if (!remainingSlots) return emptyRunSummary();
    const selected = await this.dependencies.store.listClaimableForUser(
      userId,
      Math.min(maxTasks, remainingSlots)
    );
    return this.runSelectedWithSummary(selected);
  }

  private async runSelected(selected: Array<ExecutableAiTask & { createdAt?: Date }>): Promise<number> {
    return (await this.runSelectedWithSummary(selected)).claimed;
  }

  private async runSelectedWithSummary(
    selected: Array<ExecutableAiTask & { createdAt?: Date }>
  ): Promise<AiTaskRunSummary> {
    const results = await Promise.all(selected.map(async (candidate) => {
      const task = await this.dependencies.store.claimTask(candidate.id, randomUUID());
      if (!task) return { claimed: false } as const;
      const context = await this.dependencies.resolveContext(task.userId);
      if (context) {
        const status = await this.dependencies.execute(task, context);
        if (status === 'failed') {
          const exponentialBackoff = Math.min(30_000, 1_000 * 2 ** Math.max(0, (task.attemptCount || 1) - 1));
          await this.dependencies.store.retryBatchTask(task.id, task.providerRetryAfterMs || exponentialBackoff);
        }
        return { claimed: true, status } as const;
      }
      if (task.leaseToken) await this.dependencies.store.markNeedsAction(task.id, task.leaseToken);
      return { claimed: true, status: 'needs_action' as const };
    }));
    return results.reduce<AiTaskRunSummary>((summary, result) => {
      if (!result.claimed) return summary;
      summary.claimed += 1;
      const status = result.status;
      if (status === 'succeeded') summary.succeeded += 1;
      else if (status === 'skipped') summary.skipped += 1;
      else if (status === 'failed') summary.failed += 1;
      else if (status === 'needs_action') summary.needsAction += 1;
      return summary;
    }, emptyRunSummary());
  }
}

function emptyRunSummary(): AiTaskRunSummary {
  return { claimed: 0, succeeded: 0, skipped: 0, failed: 0, needsAction: 0 };
}
