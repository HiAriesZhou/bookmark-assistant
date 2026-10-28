// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { planOrganizeScope } from '../../core';
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
let storedKey: { provider: string; last4: string } | null;
const sendMessage = vi.fn();
const requestPermission = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = {};
  parents = { a: '1', b: '1' };
  storedKey = null;
  sendMessage.mockReset();
  requestPermission.mockReset().mockResolvedValue(true);
  sendMessage.mockImplementation(async (message: { type: string; batch?: unknown }) => {
    if (message.type === 'ORGANIZE_KEY_GET') return { success: true, key: storedKey };
    if (message.type === 'ORGANIZE_KEY_SAVE') {
      storedKey = { provider: 'openai', last4: '1234' };
      return { success: true, key: storedKey };
    }
    if (message.type === 'ORGANIZE_PREVIEW_BATCH') {
      return {
        success: true,
        proposals: [
          { bookmarkId: 'a', fromParentId: '1', toFolderId: '10', reason: 'Design reading' },
          { bookmarkId: 'b', fromParentId: '1', toFolderId: '10', reason: 'Also design' },
        ],
      };
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
      getChildren: vi.fn(async () => []),
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

async function renderPanel() {
  const scope = planOrganizeScope(bookmarks, folders);
  await act(async () => {
    root.render(
      <OrganizePanel scope={scope} bookmarks={bookmarks} folders={folders} onClose={vi.fn()} />
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

it('previews suggestions, applies only selected moves and can undo them', async () => {
  storedKey = { provider: 'openai', last4: '1234' };
  await renderPanel();

  await act(async () => button('organize_start')!.click());
  await flush();
  const batchMessage = sendMessage.mock.calls
    .map(([message]) => message)
    .find((message) => message.type === 'ORGANIZE_PREVIEW_BATCH');
  expect(JSON.stringify(batchMessage)).not.toContain('token=secret');

  const checkboxes = document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes).toHaveLength(2);
  await act(async () => checkboxes[1].click());
  expect(button('organize_apply')?.textContent).toBe('organize_apply:1');

  await act(async () => button('organize_apply')!.click());
  await flush();
  expect(parents).toEqual({ a: '10', b: '1' });
  expect(document.body.textContent).toContain('organize_apply_result:1:0');
  expect(storage[ORGANIZE_UNDO_STORAGE_KEY]).toBeDefined();

  await act(async () => button('organize_undo')!.click());
  await flush();
  expect(parents).toEqual({ a: '1', b: '1' });
  expect(document.body.textContent).toContain('organize_undo_result:1:0');
});
