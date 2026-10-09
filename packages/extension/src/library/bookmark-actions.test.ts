import { afterEach, expect, it, vi } from 'vitest';
import { BOOKMARK_METADATA_STORAGE_KEY } from './bookmark-metadata';
import { deleteBookmark, saveBookmarkChanges } from './bookmark-actions';
import type { LocalBookmark } from './bookmark-library';

afterEach(() => vi.unstubAllGlobals());

it('keeps local metadata when Chrome rejects bookmark deletion', async () => {
  const remove = vi.fn().mockRejectedValue(new Error('Chrome refused deletion'));
  const storageRemove = vi.fn();
  vi.stubGlobal('chrome', {
    bookmarks: { remove },
    storage: { local: { get: vi.fn(), set: storageRemove } },
  });

  await expect(deleteBookmark('bookmark-1')).rejects.toThrow('Chrome refused deletion');
  expect(storageRemove).not.toHaveBeenCalled();
});

it('removes only the deleted bookmark metadata after Chrome succeeds', async () => {
  const store = {
    schemaVersion: 1,
    byBookmarkId: {
      'bookmark-1': { tags: ['Delete'], updatedAt: '2026-09-07T00:00:00.000Z' },
      'bookmark-2': { tags: ['Keep'], updatedAt: '2026-09-07T00:00:00.000Z' },
    },
  };
  const set = vi.fn();
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    bookmarks: { remove },
    storage: {
      local: {
        get: vi.fn(async () => ({ [BOOKMARK_METADATA_STORAGE_KEY]: store })),
        set,
      },
    },
  });

  await deleteBookmark('bookmark-1');
  expect(remove).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('bookmark-1');
  expect(set).toHaveBeenCalledWith({
    [BOOKMARK_METADATA_STORAGE_KEY]: {
      schemaVersion: 1,
      byBookmarkId: { 'bookmark-2': store.byBookmarkId['bookmark-2'] },
    },
  });
});

it('updates Chrome before persisting metadata and keeps the Chrome node identity', async () => {
  const calls: string[] = [];
  vi.stubGlobal('chrome', {
    bookmarks: {
      update: vi.fn(async () => calls.push('update')),
      move: vi.fn(async () => calls.push('move')),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => calls.push('metadata')),
      },
    },
  });
  const bookmark = {
    id: 'bookmark-1',
    parentId: 'folder-a',
    title: 'Old title',
    url: 'https://old.example',
    folderPath: 'Old folder',
    isTopLevel: false,
    duplicateCount: 1,
    metadata: { tags: [], updatedAt: '1970-01-01T00:00:00.000Z' },
  } satisfies LocalBookmark;

  await saveBookmarkChanges(bookmark, {
    title: 'New title',
    url: 'https://new.example',
    parentId: 'folder-b',
    description: 'Local description',
    tags: ['Reference'],
  });

  expect(chrome.bookmarks.update).toHaveBeenCalledWith('bookmark-1', {
    title: 'New title',
    url: 'https://new.example',
  });
  expect(chrome.bookmarks.move).toHaveBeenCalledWith('bookmark-1', { parentId: 'folder-b' });
  expect(calls).toEqual(['update', 'move', 'metadata']);
});

it('saves metadata and moves a Chrome bookmark that has an empty title', async () => {
  const update = vi.fn();
  const move = vi.fn(async () => undefined);
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    bookmarks: { update, move },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set,
      },
    },
  });
  const bookmark = {
    id: 'bookmark-1',
    parentId: 'folder-a',
    title: '',
    url: 'https://example.com',
    folderPath: 'Bookmarks bar',
    isTopLevel: true,
    duplicateCount: 1,
    metadata: { tags: [], updatedAt: '1970-01-01T00:00:00.000Z' },
  } satisfies LocalBookmark;

  await saveBookmarkChanges(bookmark, {
    title: '',
    url: bookmark.url,
    parentId: 'folder-b',
    description: 'Icon-only bookmark',
    tags: ['Toolbar'],
  });

  expect(update).not.toHaveBeenCalled();
  expect(move).toHaveBeenCalledWith('bookmark-1', { parentId: 'folder-b' });
  expect(set).toHaveBeenCalledWith({
    [BOOKMARK_METADATA_STORAGE_KEY]: {
      schemaVersion: 1,
      byBookmarkId: {
        'bookmark-1': expect.objectContaining({
          description: 'Icon-only bookmark',
          tags: ['Toolbar'],
        }),
      },
    },
  });
});

it('does not move or persist metadata when Chrome rejects the bookmark update', async () => {
  const move = vi.fn();
  const set = vi.fn();
  vi.stubGlobal('chrome', {
    bookmarks: {
      update: vi.fn().mockRejectedValue(new Error('Chrome update failed')),
      move,
    },
    storage: { local: { get: vi.fn(async () => ({})), set } },
  });
  const bookmark = {
    id: 'bookmark-1',
    parentId: 'folder-a',
    title: 'Old title',
    url: 'https://old.example',
    folderPath: 'Old folder',
    isTopLevel: false,
    duplicateCount: 1,
    metadata: { tags: [], updatedAt: '1970-01-01T00:00:00.000Z' },
  } satisfies LocalBookmark;

  await expect(
    saveBookmarkChanges(bookmark, {
      title: 'New title',
      url: 'https://new.example',
      parentId: 'folder-b',
      description: 'Keep this draft',
      tags: ['Draft'],
    })
  ).rejects.toThrow('Chrome update failed');

  expect(move).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
