// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalBookmark } from '../../library/bookmark-library';
import { ToastProvider } from '../hook/ToastProvider';
import { BookmarkEditor } from './BookmarkEditor';

const bookmark = (title: string, updatedAt: string): LocalBookmark => ({
  id: 'bookmark-1',
  parentId: 'folder-1',
  title,
  url: 'https://example.com',
  folderPath: 'Bookmarks bar',
  isTopLevel: true,
  metadata: { tags: [], updatedAt },
  duplicateCount: 1,
});

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
});

it('does not overwrite an in-progress draft when Chrome refreshes the selected bookmark', async () => {
  const render = async (selected: LocalBookmark) => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <BookmarkEditor
            bookmark={selected}
            folders={[{ id: 'folder-1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 }]}
            busy={false}
            onSave={vi.fn(async () => undefined)}
            onDelete={vi.fn(async () => undefined)}
            onDirtyChange={vi.fn()}
          />
        </ToastProvider>
      );
    });
  };

  await render(bookmark('Original title', '2026-09-07T00:00:00.000Z'));
  const titleInput = container.querySelector<HTMLInputElement>('input.library-input');
  expect(titleInput?.value).toBe('Original title');

  await act(async () => {
    if (!titleInput) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      titleInput,
      'Unsaved draft'
    );
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await render(bookmark('External refresh', '2026-09-08T00:00:00.000Z'));

  expect(titleInput?.value).toBe('Unsaved draft');
});

it('keeps edits made while an earlier save is still pending', async () => {
  let finishSave!: () => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
  );
  const onDirtyChange = vi.fn();
  await act(async () => {
    root.render(
      <ToastProvider>
        <BookmarkEditor
          bookmark={bookmark('Original title', '2026-09-07T00:00:00.000Z')}
          folders={[{ id: 'folder-1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 }]}
          busy={false}
          onSave={onSave}
          onDelete={vi.fn(async () => undefined)}
          onDirtyChange={onDirtyChange}
        />
      </ToastProvider>
    );
  });
  const titleInput = container.querySelector<HTMLInputElement>('input.library-input');
  const saveButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_save_changes"]'
  );

  changeInput(titleInput, 'First draft');
  await act(async () => saveButton?.click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'First draft' }));

  changeInput(titleInput, 'Newer draft');
  await act(async () => {
    finishSave();
    await Promise.resolve();
  });

  expect(titleInput?.value).toBe('Newer draft');
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    'library_saved_older_changes'
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});

it('keeps a failed draft editable and allows the user to retry', async () => {
  const onSave = vi
    .fn<
      (_: Parameters<React.ComponentProps<typeof BookmarkEditor>['onSave']>[0]) => Promise<void>
    >()
    .mockRejectedValueOnce(new Error('Chrome update failed'))
    .mockResolvedValueOnce(undefined);
  const onDirtyChange = vi.fn();
  await act(async () => {
    root.render(
      <ToastProvider>
        <BookmarkEditor
          bookmark={bookmark('Original title', '2026-09-07T00:00:00.000Z')}
          folders={[{ id: 'folder-1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 }]}
          busy={false}
          onSave={onSave}
          onDelete={vi.fn(async () => undefined)}
          onDirtyChange={onDirtyChange}
        />
      </ToastProvider>
    );
  });
  const titleInput = container.querySelector<HTMLInputElement>('input.library-input');
  const saveButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_save_changes"]'
  );
  changeInput(titleInput, 'Retry this title');

  await act(async () => saveButton?.click());
  expect(titleInput?.value).toBe('Retry this title');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('library_save_failed');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  await act(async () => saveButton?.click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('library_saved_locally');
  expect(container.querySelector('aside [role="status"]')).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('splits pasted tags by commas before saving', async () => {
  const onSave = vi.fn(async () => undefined);
  await act(async () => {
    root.render(
      <ToastProvider>
        <BookmarkEditor
          bookmark={bookmark('Original title', '2026-09-07T00:00:00.000Z')}
          folders={[
            { id: 'folder-1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 },
            {
              id: 'folder-2',
              title: 'Research',
              path: 'Bookmarks bar / Research',
              depth: 1,
            },
          ]}
          busy={false}
          onSave={onSave}
          onDelete={vi.fn(async () => undefined)}
          onDirtyChange={vi.fn()}
        />
      </ToastProvider>
    );
  });

  expect(container.textContent).toContain('library_bookmark_details');
  expect(container.textContent).toContain('library_tag_separator_hint');
  const tagInput = container.querySelector<HTMLInputElement>('[placeholder="library_add_tag"]');
  await act(async () => tagInput?.focus());
  changeInput(tagInput, 'Design, Research，design');
  await act(async () => tagInput?.blur());
  expect(container.textContent).toContain('Design');
  expect(container.textContent).toContain('Research');

  const saveButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_save_changes"]'
  );
  await act(async () => saveButton?.click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: ['Design', 'Research'] }));
});

it('includes an uncommitted tag draft when save is clicked directly', async () => {
  const onSave = vi.fn(async () => undefined);
  await act(async () => {
    root.render(
      <ToastProvider>
        <BookmarkEditor
          bookmark={bookmark('Original title', '2026-09-07T00:00:00.000Z')}
          folders={[{ id: 'folder-1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 }]}
          busy={false}
          onSave={onSave}
          onDelete={vi.fn()}
          onDirtyChange={vi.fn()}
        />
      </ToastProvider>
    );
  });

  const tagInput = container.querySelector<HTMLInputElement>('[placeholder="library_add_tag"]');
  changeInput(tagInput, 'Research');
  const saveButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="library_save_changes"]'
  );
  await act(async () => saveButton?.click());

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tags: ['Research'] }));
});

function changeInput(input: HTMLInputElement | null, value: string) {
  act(() => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
