// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { planCategoryMoves, planOrganizeScope, resolveCategoryTargets } from '../../core';
import type { OrganizeTask } from '../../runtime/organize';
import type { LocalBookmark, LocalBookmarkFolder } from '../../library/bookmark-library';
import { ORGANIZE_UNDO_STORAGE_KEY } from '../../library/organize-apply';
import { cleanupTestRoot, createTestRoot, type TestRoot } from '../../testing/react-root';
import { OrganizePanel } from './OrganizePanel';

const folders: LocalBookmarkFolder[] = [
  { id: '1', parentId: '0', title: 'Bar', path: 'Bar', depth: 0 },
  { id: '10', parentId: '1', title: 'Design', path: 'Bar / Design', depth: 1 },
  { id: '11', parentId: '1', title: 'Code', path: 'Bar / Code', depth: 1 },
];
const bookmarks: LocalBookmark[] = ['a', 'b'].map((id) => ({
  id,
  parentId: '1',
  title: `Title ${id}`,
  url: `https://${id}.example/page?token=secret`,
  folderPath: 'Bar',
  isTopLevel: true,
  metadata: { tags: [], updatedAt: '2026-10-21T00:00:00.000Z' },
  duplicateCount: 1,
}));

let container: HTMLDivElement;
let root: TestRoot;
let storage: Record<string, unknown>;
let parents: Record<string, string>;
let created: Array<{ id: string; parentId: string; title: string }>;
let storedKey: { provider: string; last4: string } | null;
let latestTask: OrganizeTask | null;
const sendMessage = vi.fn();
const requestPermission = vi.fn();

function completedTask(): OrganizeTask {
  const scope = planOrganizeScope(bookmarks, folders);
  const folderMap = { '10': 'learning' } as const;
  const targets = resolveCategoryTargets(folderMap, scope.folders, new Map());
  const parents = folders.map((folder): [string, string | undefined] => [
    folder.id,
    folder.parentId,
  ]);
  return {
    id: 'organize-task',
    type: 'organize',
    revision: 'credential-revision',
    status: 'succeeded',
    attempts: 0,
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    input: { scope, uiLanguage: 'en', parents, folderCounts: [] },
    state: {
      folderMap,
      targets,
      cursor: 1,
      completed: 2,
      total: 2,
      proposals: planCategoryMoves(
        [
          { bookmarkId: 'a', category: 'learning', confident: true, reason: 'Design reading' },
          { bookmarkId: 'b', category: 'career', confident: false, reason: 'Maybe a job page' },
        ],
        scope.items,
        folderMap,
        targets,
        new Map(parents)
      ),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = {};
  parents = { a: '1', b: '1' };
  created = [];
  storedKey = null;
  latestTask = null;
  sendMessage.mockReset();
  requestPermission.mockReset().mockResolvedValue(true);
  sendMessage.mockImplementation(async (message: { type: string; batch?: unknown }) => {
    if (message.type === 'ORGANIZE_KEY_GET') return { success: true, key: storedKey };
    if (message.type === 'ORGANIZE_KEY_SAVE') {
      storedKey = { provider: 'openai', last4: '1234' };
      return { success: true, key: storedKey };
    }
    if (message.type === 'ORGANIZE_TASK_GET') return { success: true, task: latestTask };
    if (message.type === 'ORGANIZE_TASK_START') {
      latestTask = completedTask();
      return { success: true, task: latestTask };
    }
    if (message.type === 'ORGANIZE_TASK_CANCEL') {
      latestTask = latestTask ? { ...latestTask, status: 'cancelled' } : null;
      return { success: true, task: latestTask };
    }
    return { success: true };
  });
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string, substitutions?: string[]) =>
        [key, ...(substitutions ?? [])].join(':'),
      getUILanguage: () => 'en',
    },
    runtime: { sendMessage },
    permissions: { request: requestPermission },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    bookmarks: {
      get: vi.fn(async (id: string) => [
        { id, parentId: parents[id], url: 'https://x.example', index: 0, title: id },
      ]),
      getTree: vi.fn(async () => [{ id: '0', children: [{ id: '1', title: 'Bar' }] }]),
      getChildren: vi.fn(async (id: string) =>
        Object.entries(parents)
          .filter(([, parentId]) => parentId === id)
          .map(([childId]) => ({ id: childId, url: 'https://x.example' }))
      ),
      create: vi.fn(async (folder: { parentId: string; title: string }) => {
        const node = { id: `new-${created.length + 1}`, ...folder };
        created.push(node);
        return node;
      }),
      remove: vi.fn(async (id: string) => {
        created = created.filter((folder) => folder.id !== id);
      }),
      move: vi.fn(async (id: string, destination: { parentId: string }) => {
        parents[id] = destination.parentId;
        return { id };
      }),
    },
  });
  ({ container, root } = createTestRoot());
});

afterEach(async () => {
  await cleanupTestRoot(root, container);
  vi.unstubAllGlobals();
});

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.startsWith(label)
  );

async function renderPanel(onClose = vi.fn()) {
  const scope = planOrganizeScope(bookmarks, folders);
  await act(async () => {
    root.render(
      <OrganizePanel scope={scope} bookmarks={bookmarks} folders={folders} onClose={onClose} />
    );
  });
  await flush();
}

it('requests the provider permission inside the click before validating the key', async () => {
  await renderPanel();
  const input = document.body.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, 'sk-test-1234');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  act(() => button('organize_key_save')!.click());
  expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://api.openai.com/*'] });
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ORGANIZE_KEY_SAVE' })
  );

  await flush();
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ORGANIZE_KEY_SAVE', provider: 'openai' })
  );
  expect(document.body.textContent).toContain('organize_key_summary:OpenAI:1234');
});

it('does not save a key when the permission is declined', async () => {
  requestPermission.mockResolvedValue(false);
  await renderPanel();
  const input = document.body.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, 'sk-test-1234');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('organize_key_save')!.click());
  await flush();

  expect(document.body.textContent).toContain('organize_error_permission');
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ORGANIZE_KEY_SAVE' })
  );
});

it('previews category moves, selects only confident ones and applies them', async () => {
  storedKey = { provider: 'openai', last4: '1234' };
  await renderPanel();

  await act(async () => button('organize_start')!.click());
  await flush();
  const sent = sendMessage.mock.calls.map(([message]) => message);
  expect(sent.map((message) => message.type)).toEqual(
    expect.arrayContaining(['ORGANIZE_TASK_GET', 'ORGANIZE_TASK_START'])
  );
  expect(JSON.stringify(sent)).not.toContain('token=secret');

  const checkboxes = document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect([...checkboxes].map((box) => box.checked)).toEqual([true, false]);
  expect(document.body.textContent).toContain('organize_low_confidence');
  expect(document.body.textContent).toContain('organize_new_folder');
  // The preview is the changed part of the tree: Design gains "a", a new Career folder
  // receives the unselected "b", and the bar keeps nothing loose afterwards.
  const tree = document.body.querySelector('[role="tree"]')!;
  expect(
    [...tree.querySelectorAll('[role="treeitem"][aria-expanded]')].map((node) =>
      node.getAttribute('aria-label')
    )
  ).toEqual(['Bar', 'Design', 'Career']);
  expect(document.body.textContent).toContain('organize_preview_stays:Bar');
  expect(button('organize_apply')?.textContent).toBe('organize_apply:1');

  await act(async () => button('organize_apply')!.click());
  await flush();
  expect(parents).toEqual({ a: '10', b: '1' });
  expect(created).toEqual([]);
  expect(document.body.textContent).toContain('organize_apply_result:1:0');

  await act(async () => button('organize_undo')!.click());
  await flush();
  expect(parents).toEqual({ a: '1', b: '1' });
  expect(document.body.textContent).toContain('organize_undo_result:1:0');
});

it('creates a missing category folder on the bar and removes it again on undo', async () => {
  storedKey = { provider: 'openai', last4: '1234' };
  await renderPanel();
  await act(async () => button('organize_start')!.click());
  await flush();
  const checkboxes = document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => checkboxes[1].click());

  await act(async () => button('organize_apply')!.click());
  await flush();
  expect(created).toEqual([{ id: 'new-1', parentId: '1', title: 'Career' }]);
  expect(parents).toEqual({ a: '10', b: 'new-1' });
  expect(storage[ORGANIZE_UNDO_STORAGE_KEY]).toMatchObject({ createdFolderIds: ['new-1'] });

  await act(async () => button('organize_undo')!.click());
  await flush();
  expect(parents).toEqual({ a: '1', b: '1' });
  expect(created).toEqual([]);
});

it.each(['stale', 'changed-revision', 'missing', 'unavailable'] as const)(
  'refuses apply when the persisted task is %s',
  async (condition) => {
    storedKey = { provider: 'openai', last4: '1234' };
    latestTask = completedTask();
    await renderPanel();
    if (condition === 'stale') latestTask = { ...latestTask, status: 'stale' };
    if (condition === 'changed-revision') latestTask = { ...latestTask, revision: 'replacement' };
    if (condition === 'missing') latestTask = null;
    if (condition === 'unavailable') sendMessage.mockRejectedValueOnce(new Error('offline'));
    await act(async () => button('organize_apply')!.click());
    expect(chrome.bookmarks.move).not.toHaveBeenCalled();
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  }
);

it('restores a running task and allows closing without cancelling it', async () => {
  storedKey = { provider: 'openai', last4: '1234' };
  latestTask = { ...completedTask(), status: 'pending' };
  const onClose = vi.fn();
  await renderPanel(onClose);
  expect(document.body.textContent).toContain('organize_progress:2:2');
  const close = document.body.querySelector<HTMLButtonElement>('[aria-label="organize_close"]')!;
  expect(close.disabled).toBe(false);
  await act(async () => close.click());
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onClose).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ORGANIZE_TASK_CANCEL' })
  );
  latestTask = completedTask();
  await renderPanel();
  expect(document.body.textContent).toContain('Design reading');
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ORGANIZE_TASK_START' })
  );
});

it('keeps close disabled while apply is checking the task and while undo writes', async () => {
  storedKey = { provider: 'openai', last4: '1234' };
  latestTask = completedTask();
  const onClose = vi.fn();
  await renderPanel(onClose);
  let finishCheck!: (response: unknown) => void;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCheck = resolve;
      })
  );
  await act(async () => button('organize_apply')!.click());
  const close = document.body.querySelector<HTMLButtonElement>('[aria-label="organize_close"]')!;
  expect(close.disabled).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finishCheck({ success: true, task: latestTask }));
  let finishMove!: () => void;
  vi.mocked(chrome.bookmarks.move).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishMove = () => resolve({ id: 'a' } as chrome.bookmarks.BookmarkTreeNode);
      })
  );
  await act(async () => button('organize_undo')!.click());
  expect(close.disabled).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finishMove());
  expect(close.disabled).toBe(false);
});
