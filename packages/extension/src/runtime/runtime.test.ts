import { describe, expect, it, vi } from 'vitest';
import { createTaskRuntime, type TaskRecord, type TaskStore } from './index';

function memoryStore(): TaskStore {
  const rows = new Map<string, TaskRecord>();
  return {
    get: async (id) => structuredClone(rows.get(id)),
    list: async () => structuredClone([...rows.values()]),
    update: async (id, change) => {
      const next = change(structuredClone(rows.get(id)));
      if (next) rows.set(id, structuredClone(next));
      return structuredClone(next);
    },
  };
}

describe('persistent task runtime', () => {
  it('does not pause a short sync after only a few local checkpoints', async () => {
    const runtime = createTaskRuntime({ store: memoryStore() });
    runtime.register('test', {
      initialize: () => 0,
      step: async (job: TaskRecord<unknown, number>) => ({
        state: job.state + 1,
        done: job.state === 29,
      }),
    });
    const job = await runtime.submit({ type: 'test', input: {}, revision: 'r1' });
    await runtime.runner();
    expect(await runtime.get(job.id)).toMatchObject({ status: 'succeeded', state: 30 });
  });

  it('resumes checkpointed work in a new worker instance', async () => {
    const store = memoryStore();
    const first = createTaskRuntime({ store, maxSteps: 1 });
    const definition = {
      initialize: () => 0,
      step: async (job: TaskRecord<unknown, number>) => ({
        state: job.state + 1,
        done: job.state === 1,
      }),
    };
    first.register('test', definition);
    const job = await first.submit({ type: 'test', input: {}, revision: 'r1' });
    await first.runner();
    expect((await first.get(job.id))?.state).toBe(1);
    const second = createTaskRuntime({ store });
    second.register('test', definition);
    await second.runner();
    expect(await second.get(job.id)).toMatchObject({ status: 'succeeded', state: 2 });
  });

  it('drops a reply after explicit cancellation', async () => {
    const runtime = createTaskRuntime({ store: memoryStore() });
    let finish!: () => void;
    runtime.register('test', {
      initialize: () => 0,
      step: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { state: 1, done: true };
      },
    });
    const job = await runtime.submit({ type: 'test', input: {}, revision: 'r1' });
    const running = runtime.runner();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await runtime.cancel(job.id);
    finish();
    await running;
    expect(await runtime.get(job.id)).toMatchObject({ status: 'cancelled', state: 0 });
  });

  it('honors retryAfter and bounds retries without retaining error text', async () => {
    let now = 1000;
    const step = vi.fn().mockRejectedValue(new Error('private title or secret'));
    const runtime = createTaskRuntime({ store: memoryStore(), now: () => now, maxAttempts: 2 });
    runtime.register('test', {
      initialize: () => 0,
      step,
      retry: () => ({ code: 'rate_limited', retryAfterMs: 90_000 }),
    });
    const job = await runtime.submit({ type: 'test', input: {}, revision: 'r1' });
    await runtime.runner();
    expect(await runtime.get(job.id)).toMatchObject({ status: 'pending', nextRunAt: 91_000 });
    await runtime.runner();
    expect(step).toHaveBeenCalledTimes(1);
    now = 91_000;
    await runtime.runner();
    expect(await runtime.get(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'rate_limited',
    });
    expect(JSON.stringify(await runtime.get(job.id))).not.toContain('private');
  });

  it('rejects results after credential revision changes', async () => {
    let current = true;
    const runtime = createTaskRuntime({ store: memoryStore() });
    runtime.register('test', {
      initialize: () => 0,
      isCurrent: async () => current,
      step: async () => {
        current = false;
        return { state: 1, done: true };
      },
    });
    const job = await runtime.submit({ type: 'test', input: {}, revision: 'old' });
    await runtime.runner();
    expect(await runtime.get(job.id)).toMatchObject({ status: 'stale', state: 0 });
  });
});
