import { expect, it, vi } from 'vitest';
import {
  createOrganizeTaskHandlers,
  prepareOrganizeTaskInput,
  registerOrganizeTask,
} from './organize';
import { createTaskRuntime, type TaskRecord, type TaskStore } from './index';

vi.mock('../background/library-organize', () => ({
  readOrganizeCredentialRevision: vi.fn().mockResolvedValue('revision'),
  runFolderMap: vi.fn().mockResolvedValue({ folderMap: {} }),
  runAssignBatch: vi.fn().mockResolvedValue({ assignments: [] }),
  OrganizeError: class extends Error {},
}));

it('projects task inputs and excludes private, managed-equivalent or credential-bearing URLs', () => {
  const input = prepareOrganizeTaskInput({
    scope: {
      items: [
        {
          id: 'public',
          parentId: '1',
          title: 'Public',
          url: 'https://example.com/a?secret=value',
          folderPath: 'Bar',
          apiKey: 'secret',
        },
        {
          id: 'private',
          parentId: '1',
          title: 'Private payroll',
          url: 'http://10.0.0.1',
          folderPath: 'Bar',
        },
      ],
      folders: [{ id: '1', parentId: '0', path: 'Bar' }],
      totalCandidates: 2,
      excludedCount: 0,
    },
    uiLanguage: 'en',
    parents: [['1', '0']],
    folderCounts: [['1', 2]],
    apiKey: 'secret',
  });
  expect(input.scope.items).toEqual([
    {
      id: 'public',
      parentId: '1',
      title: 'Public',
      url: 'https://example.com/a',
      folderPath: 'Bar',
    },
  ]);
  expect(JSON.stringify(input)).not.toContain('secret');
  expect(JSON.stringify(input)).not.toContain('Private payroll');
});

function organizeFixture(maxSteps: number) {
  const rows = new Map<string, TaskRecord>();
  const store: TaskStore = {
    get: async (id) => rows.get(id),
    list: async () => [...rows.values()],
    update: async (id, change) => {
      const next = change(rows.get(id));
      if (next) rows.set(id, next);
      return next;
    },
  };
  const runtime = createTaskRuntime({ store, maxSteps });
  registerOrganizeTask(runtime);
  const submit = () =>
    runtime.submit({
      type: 'organize',
      revision: 'revision',
      dedupeKey: 'organize',
      input: {
        scope: {
          items: [
            { id: 'a', parentId: '1', title: 'A', url: 'https://example.com/', folderPath: 'Bar' },
          ],
          folders: [],
          totalCandidates: 1,
          excludedCount: 0,
        },
        uiLanguage: 'en',
        parents: [],
        folderCounts: [],
      },
    });
  return { runtime, submit, handlers: createOrganizeTaskHandlers(runtime) };
}

it('checkpoints folder mapping independently of classification', async () => {
  const { runtime, submit } = organizeFixture(1);
  const job = await submit();
  await runtime.runner();
  expect(await runtime.get(job.id)).toMatchObject({
    status: 'pending',
    state: { completed: 1, total: 2, cursor: 0 },
  });
});

it('stops restoring an organize result after it was applied or discarded', async () => {
  // 已处理的结果若仍被恢复，界面会一直停在旧预览，无法开始新的整理。
  const { runtime, submit, handlers } = organizeFixture(10);
  const job = await submit();
  await runtime.runner();
  const get = (id?: string) => handlers.ORGANIZE_TASK_GET({ type: 'ORGANIZE_TASK_GET', id });
  expect(await get()).toMatchObject({ success: true, task: { id: job.id, status: 'succeeded' } });

  await handlers.ORGANIZE_TASK_DISMISS({ type: 'ORGANIZE_TASK_DISMISS', id: job.id });
  expect(await get()).toEqual({ success: true, task: null });
  expect(await get(job.id)).toMatchObject({ success: true, task: { id: job.id } });
});

it('keeps restoring a task that is still running even if dismissal is requested', async () => {
  const { submit, handlers } = organizeFixture(10);
  const job = await submit();
  await handlers.ORGANIZE_TASK_DISMISS({ type: 'ORGANIZE_TASK_DISMISS', id: job.id });
  expect(await handlers.ORGANIZE_TASK_GET({ type: 'ORGANIZE_TASK_GET' })).toMatchObject({
    success: true,
    task: { id: job.id, status: 'pending' },
  });
});

it('cancels by attempt while the submission is waiting to become durable', async () => {
  const { runtime, submit, handlers } = organizeFixture(0);
  const input = (await submit()).input as Parameters<
    typeof handlers.ORGANIZE_TASK_START
  >[0]['input'];
  await runtime.cancel((await runtime.list())[0].id);
  let release!: () => void;
  let began!: () => void;
  const waiting = new Promise<void>((resolve) => {
    began = resolve;
  });
  runtime.setWake(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        began();
      })
  );
  const start = handlers.ORGANIZE_TASK_START({
    type: 'ORGANIZE_TASK_START',
    input: { ...input, attemptId: 'delayed-attempt' },
  });
  await waiting;
  const cancel = handlers.ORGANIZE_TASK_CANCEL({
    type: 'ORGANIZE_TASK_CANCEL',
    attemptId: 'delayed-attempt',
  });
  release();
  const started = await start;
  expect(started.success).toBe(true);
  const cancelled = await cancel;
  expect(cancelled).toMatchObject({
    success: true,
    task: { status: 'cancelled', input: { attemptId: 'delayed-attempt' } },
  });
  const job = (cancelled as Extract<typeof cancelled, { success: true }>).task!;
  expect((await runtime.get(job.id))?.status).toBe('cancelled');
});

it('finds a deduplicated submission by its attempt after handlers are recreated', async () => {
  const { runtime, submit, handlers } = organizeFixture(0);
  const job = await submit();
  const input = job.input as Parameters<typeof handlers.ORGANIZE_TASK_START>[0]['input'];
  expect(
    await handlers.ORGANIZE_TASK_START({
      type: 'ORGANIZE_TASK_START',
      input: { ...input, attemptId: 'new-attempt' },
    })
  ).toMatchObject({ success: true, task: { id: job.id } });
  const restoredHandlers = createOrganizeTaskHandlers(runtime);
  expect(
    await restoredHandlers.ORGANIZE_TASK_GET({
      type: 'ORGANIZE_TASK_GET',
      attemptId: 'new-attempt',
    })
  ).toMatchObject({ success: true, task: { id: job.id } });
  expect(
    await restoredHandlers.ORGANIZE_TASK_CANCEL({
      type: 'ORGANIZE_TASK_CANCEL',
      attemptId: 'new-attempt',
    })
  ).toMatchObject({ success: true, task: { id: job.id, status: 'cancelled' } });
  expect(await runtime.list()).toHaveLength(1);
});
