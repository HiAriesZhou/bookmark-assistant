// @vitest-environment jsdom
import { act, useState } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildLocalBookmarkIndex, type LibraryFilter } from '../../library/bookmark-library';
import type { useLocalLibrary } from '../hook/useLocalLibrary';
import { ToastProvider } from '../hook/ToastProvider';
import { LocalLibraryWorkspace } from './LocalLibraryWorkspace';

let container: HTMLDivElement;
let root: TestRoot;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => 'en',
    },
  });
  ({ container, root } = createTestRoot());
});

afterEach(async () => {
  await cleanupTestRoot(root, container);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('asks before selecting another bookmark when the editor has an unsaved draft', async () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks bar',
          children: [
            { id: 'a', parentId: '1', title: 'First bookmark', url: 'https://a.example' },
            { id: 'b', parentId: '1', title: 'Second bookmark', url: 'https://b.example' },
          ],
        },
      ],
    },
  ] as chrome.bookmarks.BookmarkTreeNode[];
  const index = buildLocalBookmarkIndex(tree, {});
  const controller = {
    library: {
      tree,
      readingList: [],
      health: {
        version: 1,
        bookmarkCount: 2,
        userFolderCount: 1,
        readingListCount: 0,
        duplicateGroupCount: 0,
        duplicateExtraItemCount: 0,
        topLevelUncategorizedCount: 0,
        largestFolderItemCount: 2,
        estimatedLocalSyncItems: 2,
      },
      ...index,
    },
    error: false,
    isMutating: false,
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof useLocalLibrary>;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  function Harness() {
    const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
    const [dirty, setDirty] = useState(false);
    return (
      <LocalLibraryWorkspace
        controller={controller}
        filter={filter}
        onFilterChange={setFilter}
        hasUnsavedDraft={dirty}
        onUnsavedDraftChange={setDirty}
        editorRevision={0}
      />
    );
  }

  await act(async () =>
    root.render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
  );
  const titleInput = container.querySelector<HTMLInputElement>('input.library-input');
  expect(titleInput?.value).toBe('First bookmark');
  changeInput(titleInput, 'Unsaved title');

  const secondBookmark = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Second bookmark')
  );
  await act(async () => secondBookmark?.click());

  expect(confirm).toHaveBeenCalledWith('library_discard_changes_confirm');
  expect(titleInput?.value).toBe('Unsaved title');

  const rowDelete = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_delete_bookmark"]'
  );
  await act(async () => rowDelete?.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'library_delete_quick_confirm'
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  const cancelDelete = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === 'action_cancel'
  );
  await act(async () => cancelDelete?.click());
  expect(controller.remove).not.toHaveBeenCalled();
  expect(titleInput?.value).toBe('Unsaved title');

  confirm.mockReturnValue(true);
  const filterMenu = container.querySelector<HTMLButtonElement>('[aria-label="library_filter"]');
  await act(async () => filterMenu?.click());
  const duplicateFilter = Array.from(document.querySelectorAll('[role="option"]')).find((option) =>
    option.textContent?.includes('library_duplicates')
  ) as HTMLButtonElement | undefined;
  await act(async () => duplicateFilter?.click());

  expect(container.textContent).toContain('library_select_bookmark');
  expect(container.textContent).not.toContain('Unsaved title');
});

it('keeps an active tag filter labeled after its last tag is removed', async () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks bar',
          children: [{ id: 'a', parentId: '1', title: 'Tagged', url: 'https://a.example' }],
        },
      ],
    },
  ] as chrome.bookmarks.BookmarkTreeNode[];

  function Harness() {
    const [library, setLibrary] = useState(() =>
      buildLocalBookmarkIndex(tree, {
        a: { tags: ['ReviewTag'], updatedAt: '2026-09-10T00:00:00.000Z' },
      })
    );
    const controller = {
      library: {
        tree,
        readingList: [],
        health: {},
        ...library,
      },
      error: false,
      isMutating: false,
      refresh: vi.fn(async () => undefined),
      save: vi.fn(async (_bookmark, changes) => {
        setLibrary(
          buildLocalBookmarkIndex(tree, {
            a: { tags: changes.tags, updatedAt: '2026-09-10T00:01:00.000Z' },
          })
        );
      }),
      remove: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useLocalLibrary>;
    return (
      <LocalLibraryWorkspace
        controller={controller}
        filter={{ kind: 'tag', tag: 'ReviewTag' }}
        onFilterChange={() => undefined}
        hasUnsavedDraft={false}
        onUnsavedDraftChange={() => undefined}
        editorRevision={0}
      />
    );
  }

  await act(async () =>
    root.render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
  );
  const removeTag = container.querySelector<HTMLButtonElement>('[aria-label="library_remove_tag"]');
  await act(async () => removeTag?.click());
  const save = container.querySelector<HTMLButtonElement>('[aria-label="library_save_changes"]');
  await act(async () => save?.click());

  const filterMenu = container.querySelector<HTMLButtonElement>('[aria-label="library_filter"]');
  expect(filterMenu?.textContent).toContain('ReviewTag');
  expect(container.querySelector('h1')?.textContent).toBe('ReviewTag');
});

it('shows both saved tags in the row from the same metadata snapshot as the editor', async () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks bar',
          children: [{ id: 'a', parentId: '1', title: 'Tagged', url: 'https://a.example' }],
        },
      ],
    },
  ] as chrome.bookmarks.BookmarkTreeNode[];

  function Harness() {
    const [metadata, setMetadata] = useState({
      a: { tags: ['Design'], updatedAt: '2026-09-10T00:00:00.000Z' },
    });
    const index = buildLocalBookmarkIndex(tree, metadata);
    const controller = {
      library: { tree, readingList: [], health: {}, ...index },
      error: false,
      isMutating: false,
      refresh: vi.fn(async () => undefined),
      save: vi.fn(async (_bookmark, changes) => {
        setMetadata({
          a: { tags: changes.tags, updatedAt: '2026-09-10T00:01:00.000Z' },
        });
      }),
      remove: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof useLocalLibrary>;
    return (
      <LocalLibraryWorkspace
        controller={controller}
        filter={{ kind: 'all' }}
        onFilterChange={() => undefined}
        hasUnsavedDraft={false}
        onUnsavedDraftChange={() => undefined}
        editorRevision={0}
      />
    );
  }

  await act(async () =>
    root.render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
  );
  const tagInput = container.querySelector<HTMLInputElement>('[placeholder="library_add_tag"]');
  changeInput(tagInput, 'UI/UX');
  const saveButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_save_changes"]'
  );
  await act(async () => {
    saveButton?.click();
    await Promise.resolve();
  });

  const row = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.includes('Tagged'))
    ?.closest('div.group');
  expect(row?.textContent).toContain('Design');
  expect(row?.textContent).toContain('UI/UX');
});

it('keeps the remaining bookmark visible after resolving a two-item duplicate group', async () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          parentId: '0',
          title: 'Bookmarks bar',
          children: [
            { id: 'a', parentId: '1', title: 'Delete copy', url: 'https://example.com?a=1&b=2' },
            { id: 'b', parentId: '1', title: 'Keep copy', url: 'https://example.com?b=2&a=1' },
          ],
        },
      ],
    },
  ] as chrome.bookmarks.BookmarkTreeNode[];
  const remainingTree = [
    {
      ...tree[0],
      children: [{ ...tree[0].children![0], children: [tree[0].children![0].children![1]] }],
    },
  ] as chrome.bookmarks.BookmarkTreeNode[];
  const remainingIndex = buildLocalBookmarkIndex(remainingTree, {});
  const refreshedLibrary = {
    tree: remainingTree,
    readingList: [],
    health: {},
    ...remainingIndex,
  };
  const remove = vi.fn(async (_bookmarkId: string) => undefined);
  const refresh = vi.fn(async () => refreshedLibrary);
  function Harness() {
    const [filter, setFilter] = useState<LibraryFilter>({ kind: 'duplicates' });
    const [index, setIndex] = useState(() => buildLocalBookmarkIndex(tree, {}));
    const controller = {
      library: { tree, readingList: [], health: {}, ...index },
      error: false,
      isMutating: false,
      refresh,
      save: vi.fn(async () => undefined),
      remove: vi.fn(async (bookmarkId: string) => {
        await remove(bookmarkId);
        setIndex(buildLocalBookmarkIndex(remainingTree, {}));
      }),
    } as unknown as ReturnType<typeof useLocalLibrary>;
    return (
      <LocalLibraryWorkspace
        controller={controller}
        filter={filter}
        onFilterChange={setFilter}
        hasUnsavedDraft={false}
        onUnsavedDraftChange={() => undefined}
        editorRevision={0}
      />
    );
  }

  await act(async () =>
    root.render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
  );
  const rename = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_rename_bookmark"]'
  );
  await act(async () => rename?.click());
  expect(document.activeElement).toBe(container.querySelector('input.library-input'));

  const deleteAction = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_delete_bookmark"]'
  );
  await act(async () => deleteAction?.click());
  const confirmDelete = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === 'library_delete_bookmark'
  );
  await act(async () => confirmDelete?.click());

  expect(remove).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('a');
  expect(container.querySelector('h1')?.textContent).toBe('library_duplicates');
  expect(container.textContent).toContain('Keep copy');
  expect(container.textContent).toContain('library_duplicate_kept_badge');
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    'library_duplicate_removed_kept'
  );

  const refreshDuplicates = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_refresh_duplicates"]'
  );
  await act(async () => refreshDuplicates?.click());
  expect(refresh).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('Keep copy');
});

function changeInput(input: HTMLInputElement | null, value: string) {
  act(() => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
