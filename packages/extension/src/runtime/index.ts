import { createIndexedDbTaskStore } from './store';
import { isTaskActive, type TaskDefinition, type TaskRecord, type TaskStore } from './types';
export * from './types';

const DEFAULT_MAX_ATTEMPTS = 3;
// 快速的本地检查点不应每处理几条链接就等待下一次 30 秒唤醒。
// 网络请求耗时较长时，仍由单次运行的时间预算限制处理范围。
const DEFAULT_MAX_STEPS = 128;
const RUN_BUDGET_MS = 20_000;

export function createTaskRuntime(
  options: { store?: TaskStore; now?: () => number; maxAttempts?: number; maxSteps?: number } = {}
) {
  const store = options.store ?? createIndexedDbTaskStore();
  const now = options.now ?? Date.now;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  // Definitions are registered statically by trusted background code, never messages.
  const definitions = new Map<string, TaskDefinition<unknown, unknown>>();
  const controllers = new Map<string, AbortController>();
  let running: Promise<void> | undefined;
  let submitting: Promise<unknown> = Promise.resolve();
  let wake: () => Promise<void> = async () => undefined;
  const list = async (type?: string) =>
    (await store.list()).filter((job) => !type || job.type === type);
  const patch = (job: TaskRecord, changes: Partial<TaskRecord>) =>
    store.update(job.id, (current) =>
      current?.version === job.version && current.status === job.status
        ? { ...current, ...changes, version: current.version + 1, updatedAt: now() }
        : undefined
    );

  async function runStep(job: TaskRecord, definition: TaskDefinition<unknown, unknown>) {
    if (definition.isCurrent && !(await definition.isCurrent(job))) {
      await patch(job, { status: 'stale', errorCode: 'not_configured', settled: false });
      return;
    }
    if (job.attempts >= maxAttempts) {
      await patch(job, {
        status: 'failed',
        errorCode: job.errorCode ?? 'interrupted',
        settled: false,
      });
      return;
    }
    const claimed = await patch(job, { status: 'running', attempts: job.attempts + 1 });
    if (!claimed) return;
    const controller = new AbortController();
    controllers.set(job.id, controller);
    try {
      const result = await definition.step(claimed, { signal: controller.signal });
      if (definition.isCurrent && !(await definition.isCurrent(claimed))) {
        await patch(claimed, { status: 'stale', errorCode: 'not_configured', settled: false });
        return;
      }
      await patch(claimed, {
        state: result.state,
        status: result.done ? 'succeeded' : 'pending',
        attempts: 0,
        nextRunAt: now(),
        errorCode: undefined,
        ...(result.done ? { settled: false } : {}),
      });
    } catch (error) {
      const failure = definition.retry?.(error);
      const retryable = failure && failure.retryable !== false && claimed.attempts < maxAttempts;
      const retryAfter = failure?.retryAfterMs;
      const delay =
        typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter
          : 5_000 * 2 ** (claimed.attempts - 1);
      await patch(claimed, {
        status: retryable ? 'pending' : 'failed',
        errorCode: failure?.code ?? 'task_failed',
        nextRunAt: now() + delay,
        ...(retryable ? {} : { settled: false }),
      });
    } finally {
      controllers.delete(job.id);
    }
  }

  async function settle(job: TaskRecord) {
    const definition = definitions.get(job.type);
    if (!definition?.onSettled || job.settled || isTaskActive(job)) return;
    try {
      await definition.onSettled(job);
      await patch(job, { settled: true });
    } catch (error) {
      console.warn(
        '[TaskRuntime] Terminal state was not recorded:',
        error instanceof Error ? error.name : 'unknown'
      );
    }
  }

  async function drain() {
    const started = now();
    for (const job of await list()) await settle(job);
    for (let index = 0; index < (options.maxSteps ?? DEFAULT_MAX_STEPS); index++) {
      const candidates = (await list()).filter(
        (job) => isTaskActive(job) && job.nextRunAt <= now() && definitions.has(job.type)
      );
      const job = candidates.sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!job || now() - started >= RUN_BUDGET_MS) break;
      await runStep(job, definitions.get(job.type)!);
      const settledJob = await store.get(job.id);
      if (settledJob) await settle(settledJob);
    }
  }

  const runtime = {
    register<Input, State>(type: string, definition: TaskDefinition<Input, State>) {
      if (definitions.has(type)) throw new Error('task_type_already_registered');
      definitions.set(type, definition as TaskDefinition<unknown, unknown>);
    },
    setWake(callback: () => Promise<void>) {
      wake = callback;
    },
    get: store.get,
    list,
    submit<Input>({
      type,
      input,
      revision,
      dedupeKey,
      submissionId,
    }: {
      type: string;
      input: Input;
      revision: string;
      dedupeKey?: string;
      submissionId?: string;
    }): Promise<TaskRecord> {
      const operation = submitting.then(async () => {
        const definition = definitions.get(type);
        if (!definition || !revision) throw new Error('invalid_task');
        const jobs = await list(type);
        const existing =
          (submissionId
            ? jobs.find(
                (job) => job.revision === revision && job.submissionIds?.includes(submissionId)
              )
            : undefined) ??
          (dedupeKey
            ? jobs.find(
                (job) =>
                  job.dedupeKey === dedupeKey && job.revision === revision && isTaskActive(job)
              )
            : undefined);
        if (existing) {
          if (!submissionId || existing.submissionIds?.includes(submissionId)) return existing;
          return (
            (await store.update(existing.id, (current) =>
              current
                ? {
                    ...current,
                    submissionIds: [...(current.submissionIds ?? []), submissionId],
                  }
                : current
            )) ?? existing
          );
        }
        const timestamp = now();
        const job: TaskRecord = {
          id: crypto.randomUUID(),
          type,
          input,
          state: definition.initialize(input),
          revision,
          dedupeKey,
          ...(submissionId ? { submissionIds: [submissionId] } : {}),
          status: 'pending',
          attempts: 0,
          nextRunAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 0,
        };
        // Scheduling intent must exist before acknowledging a durable submission.
        await wake();
        await store.update(job.id, () => job);
        return job;
      });
      submitting = operation.catch(() => undefined);
      return operation;
    },
    async cancel(id: string) {
      controllers.get(id)?.abort();
      return store.update(id, (job) =>
        job && isTaskActive(job)
          ? {
              ...job,
              status: 'cancelled',
              settled: false,
              updatedAt: now(),
              version: job.version + 1,
            }
          : job
      );
    },
    /** Marks a finished result as handled. Active tasks are left untouched. */
    async dismiss(id: string) {
      return store.update(id, (job) =>
        job && !isTaskActive(job) && !job.dismissed
          ? { ...job, dismissed: true, updatedAt: now(), version: job.version + 1 }
          : job
      );
    },
    async retry(id: string) {
      const job = await store.get(id);
      if (!job || !['failed', 'cancelled'].includes(job.status)) return job;
      const definition = definitions.get(job.type);
      if (!definition || (definition.isCurrent && !(await definition.isCurrent(job))))
        return patch(job, { status: 'stale', errorCode: 'not_configured', settled: false });
      await wake();
      return patch(job, {
        status: 'pending',
        attempts: 0,
        errorCode: undefined,
        settled: undefined,
        dismissed: undefined,
        nextRunAt: now(),
      });
    },
    runner(): Promise<void> {
      if (!running)
        running = drain().finally(() => {
          running = undefined;
        });
      return running;
    },
  };
  return runtime;
}

export type TaskRuntime = ReturnType<typeof createTaskRuntime>;
