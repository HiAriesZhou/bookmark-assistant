import { expect, it, vi } from 'vitest';
import { prepareOrganizeTaskInput, registerOrganizeTask } from './organize';
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

it('checkpoints folder mapping independently of classification', async () => {
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
  const runtime = createTaskRuntime({ store, maxSteps: 1 });
  registerOrganizeTask(runtime);
  const job = await runtime.submit({
    type: 'organize',
    revision: 'revision',
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
  await runtime.runner();
  expect(await runtime.get(job.id)).toMatchObject({
    status: 'pending',
    state: { completed: 1, total: 2, cursor: 0 },
  });
});
