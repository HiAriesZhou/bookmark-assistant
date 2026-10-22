import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORGANIZE_UNDO_STORAGE_KEY,
  applyOrganizeMoves,
  readOrganizeUndo,
  undoOrganizeMoves,
} from './organize-apply';

interface FakeNode {
  id: string;
  parentId?: string;
  url?: string;
  unmodifiable?: 'managed';
}

let nodes: Map<string, FakeNode>;
let children: Map<string, string[]>;
let storage: Record<string, unknown>;
let failMoveFor: Set<string>;

function addNode(node: FakeNode) {
  nodes.set(node.id, node);
  if (!node.parentId) return;
  children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
}

function childIds(parentId: string) {
  return children.get(parentId) ?? [];
}

beforeEach(() => {
  nodes = new Map();
  children = new Map();
  storage = {};
  failMoveFor = new Set();
  ['1', '10', '11'].forEach((id) => addNode({ id, parentId: id === '1' ? '0' : '1' }));
  ['a', 'b', 'c'].forEach((id) => addNode({ id, parentId: '1', url: `https://${id}.example` }));

  vi.stubGlobal('chrome', {
    bookmarks: {
      get: vi.fn(async (id: string) => {
        const node = nodes.get(id);
        if (!node) throw new Error("Can't find bookmark for id.");
        const index = node.parentId ? childIds(node.parentId).indexOf(id) : 0;
        return [{ ...node, index, title: id }];
      }),
      getChildren: vi.fn(async (id: string) => childIds(id).map((child) => nodes.get(child))),
      move: vi.fn(async (id: string, destination: { parentId: string; index?: number }) => {
        if (failMoveFor.has(id)) throw new Error('Chrome refused move');
        const node = nodes.get(id)!;
        children.set(
          node.parentId!,
          childIds(node.parentId!).filter((child) => child !== id)
        );
        const target = [...childIds(destination.parentId)];
        if (destination.index !== undefined && destination.index > target.length) {
          throw new Error('Index out of bounds.');
        }
        target.splice(destination.index ?? target.length, 0, id);
        children.set(destination.parentId, target);
        nodes.set(id, { ...node, parentId: destination.parentId });
        return { ...node, parentId: destination.parentId };
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('applyOrganizeMoves', () => {
  it('moves accepted bookmarks and records how to undo them', async () => {
    const result = await applyOrganizeMoves([
      { bookmarkId: 'a', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'c', fromParentId: '1', toFolderId: '11' },
    ]);

    expect(result).toEqual({ moved: 2, skipped: 0 });
    expect(childIds('10')).toEqual(['a']);
    expect(childIds('11')).toEqual(['c']);
    const journal = await readOrganizeUndo();
    expect(journal?.entries).toEqual([
      { bookmarkId: 'a', fromParentId: '1', fromIndex: 2, toParentId: '10' },
      { bookmarkId: 'c', fromParentId: '1', fromIndex: 3, toParentId: '11' },
    ]);
  });

  it('skips bookmarks changed, deleted or managed since the preview', async () => {
    nodes.set('b', { ...nodes.get('b')!, parentId: '11' });
    addNode({ id: 'm', parentId: '1', url: 'https://m.example', unmodifiable: 'managed' });

    const result = await applyOrganizeMoves([
      { bookmarkId: 'b', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'gone', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'm', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'a', fromParentId: '1', toFolderId: '10' },
    ]);

    expect(result).toEqual({ moved: 1, skipped: 3 });
    expect(childIds('10')).toEqual(['a']);
  });

  it('keeps going when Chrome rejects one move', async () => {
    failMoveFor.add('a');
    const result = await applyOrganizeMoves([
      { bookmarkId: 'a', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'b', fromParentId: '1', toFolderId: '10' },
    ]);
    expect(result).toEqual({ moved: 1, skipped: 1 });
    expect((await readOrganizeUndo())?.entries.map((entry) => entry.bookmarkId)).toEqual(['b']);
  });

  it('writes the journal before the first move', async () => {
    const move = vi.mocked(chrome.bookmarks.move);
    move.mockImplementationOnce(async () => {
      expect(storage[ORGANIZE_UNDO_STORAGE_KEY]).toBeDefined();
      throw new Error('stop');
    });
    await applyOrganizeMoves([{ bookmarkId: 'a', fromParentId: '1', toFolderId: '10' }]);
  });

  it('leaves the previous undo journal alone when nothing can be moved', async () => {
    await applyOrganizeMoves([{ bookmarkId: 'a', fromParentId: '1', toFolderId: '10' }]);
    const before = await readOrganizeUndo();
    await applyOrganizeMoves([{ bookmarkId: 'gone', fromParentId: '1', toFolderId: '10' }]);
    expect(await readOrganizeUndo()).toEqual(before);
  });
});

describe('undoOrganizeMoves', () => {
  it('restores the original folders and order', async () => {
    const original = [...childIds('1')];
    await applyOrganizeMoves([
      { bookmarkId: 'a', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'b', fromParentId: '1', toFolderId: '10' },
    ]);

    await expect(undoOrganizeMoves()).resolves.toEqual({ restored: 2, skipped: 0 });
    expect(childIds('1')).toEqual(original);
    expect(await readOrganizeUndo()).toBeUndefined();
  });

  it('does not pull back bookmarks the user moved again', async () => {
    await applyOrganizeMoves([
      { bookmarkId: 'a', fromParentId: '1', toFolderId: '10' },
      { bookmarkId: 'b', fromParentId: '1', toFolderId: '10' },
    ]);
    await chrome.bookmarks.move('a', { parentId: '11' });

    await expect(undoOrganizeMoves()).resolves.toEqual({ restored: 1, skipped: 1 });
    expect(nodes.get('a')?.parentId).toBe('11');
    expect(nodes.get('b')?.parentId).toBe('1');
  });

  it('clamps the original position when the folder has fewer items now', async () => {
    await applyOrganizeMoves([{ bookmarkId: 'c', fromParentId: '1', toFolderId: '10' }]);
    children.set('1', []);
    await expect(undoOrganizeMoves()).resolves.toEqual({ restored: 1, skipped: 0 });
    expect(childIds('1')).toEqual(['c']);
  });

  it('serializes apply and undo so a newer journal survives a running undo', async () => {
    await applyOrganizeMoves([{ bookmarkId: 'a', fromParentId: '1', toFolderId: '10' }]);
    const undoing = undoOrganizeMoves();
    const applying = applyOrganizeMoves([{ bookmarkId: 'b', fromParentId: '1', toFolderId: '11' }]);

    await expect(undoing).resolves.toEqual({ restored: 1, skipped: 0 });
    await expect(applying).resolves.toEqual({ moved: 1, skipped: 0 });
    expect((await readOrganizeUndo())?.entries.map((entry) => entry.bookmarkId)).toEqual(['b']);
  });

  it('keeps a journal that a newer run wrote during the undo', async () => {
    await applyOrganizeMoves([{ bookmarkId: 'a', fromParentId: '1', toFolderId: '10' }]);
    const newer = { schemaVersion: 1, createdAt: '2999-01-01T00:00:00.000Z', entries: [] };
    vi.mocked(chrome.bookmarks.move).mockImplementationOnce(async () => {
      storage[ORGANIZE_UNDO_STORAGE_KEY] = newer;
      return {} as chrome.bookmarks.BookmarkTreeNode;
    });

    await undoOrganizeMoves();
    expect(storage[ORGANIZE_UNDO_STORAGE_KEY]).toEqual(newer);
  });

  it('reports nothing to undo without a journal', async () => {
    await expect(undoOrganizeMoves()).resolves.toEqual({ restored: 0, skipped: 0 });
  });
});
