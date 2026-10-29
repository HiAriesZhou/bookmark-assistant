/// <reference types="chrome" />

/**
 * Bulk moves reach every device through Chrome Sync, so each one is journaled
 * before it happens and the latest organization run can be undone.
 */
export const ORGANIZE_UNDO_STORAGE_KEY = 'library_organize_undo_v1';
const ORGANIZE_JOURNAL_LOCK = 'library-organize-journal-v1';
let journalQueue: Promise<unknown> = Promise.resolve();

export interface OrganizeMove {
  bookmarkId: string;
  fromParentId: string;
  toFolderId: string;
}

export interface OrganizeUndoEntry {
  bookmarkId: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
}

export interface OrganizeUndoJournal {
  schemaVersion: 1;
  createdAt: string;
  entries: OrganizeUndoEntry[];
  /** Category folders this run created; undo removes them once they are empty again. */
  createdFolderIds?: string[];
}

export interface ApplyOrganizeOptions {
  /** Placeholder folder ids that stand for new category folders, with their titles. */
  newFolderTitles?: Record<string, string>;
}

export async function readOrganizeUndo(): Promise<OrganizeUndoJournal | undefined> {
  const value = (await chrome.storage.local.get(ORGANIZE_UNDO_STORAGE_KEY))[
    ORGANIZE_UNDO_STORAGE_KEY
  ] as OrganizeUndoJournal | undefined;
  if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) return undefined;
  return value;
}

/** Skips anything that changed after the preview: the user's edits win. */
export function applyOrganizeMoves(
  moves: OrganizeMove[],
  options: ApplyOrganizeOptions = {}
): Promise<{ moved: number; skipped: number }> {
  return withJournalLock(() => applyMoves(moves, options.newFolderTitles ?? {}));
}

/** Moves bookmarks back in reverse order, leaving ones the user moved again. */
export function undoOrganizeMoves(): Promise<{ restored: number; skipped: number }> {
  return withJournalLock(undoMoves);
}

/** Apply and undo share one journal, including across Options tabs. */
function withJournalLock<T>(operation: () => Promise<T>): Promise<T> {
  const locked = (): Promise<T> => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks
      ? locks.request<Promise<T>>(ORGANIZE_JOURNAL_LOCK, operation).then((result) => result)
      : operation();
  };
  const next = journalQueue.then(locked, locked);
  journalQueue = next.catch(() => undefined);
  return next;
}

async function applyMoves(
  requested: OrganizeMove[],
  newFolderTitles: Record<string, string>
): Promise<{ moved: number; skipped: number }> {
  const previous = await readOrganizeUndo();
  const { folderIds, createdFolderIds } = await resolveNewFolders(requested, newFolderTitles);
  const moves = requested.map((move) => ({
    ...move,
    toFolderId: folderIds.get(move.toFolderId) ?? move.toFolderId,
  }));
  let journal: OrganizeUndoJournal | undefined;
  let skipped = 0;

  for (const move of moves) {
    const node = await getNode(move.bookmarkId);
    if (!node?.url || node.unmodifiable || node.parentId !== move.fromParentId) {
      skipped += 1;
      continue;
    }
    // Capture the position right before this move so a reverse-order undo restores order.
    const entry: OrganizeUndoEntry = {
      bookmarkId: move.bookmarkId,
      fromParentId: move.fromParentId,
      fromIndex: node.index ?? 0,
      toParentId: move.toFolderId,
    };
    const withEntry: OrganizeUndoJournal = {
      schemaVersion: 1,
      createdAt: journal?.createdAt ?? new Date().toISOString(),
      entries: [...(journal?.entries ?? []), entry],
      ...(createdFolderIds.length ? { createdFolderIds } : {}),
    };
    await writeJournal(withEntry);
    try {
      await chrome.bookmarks.move(move.bookmarkId, { parentId: move.toFolderId });
      journal = withEntry;
    } catch {
      skipped += 1;
      if (journal) await writeJournal(journal);
    }
  }

  if (!journal) {
    await removeEmptyFolders(createdFolderIds);
    await (previous
      ? writeJournal(previous)
      : chrome.storage.local.remove(ORGANIZE_UNDO_STORAGE_KEY));
    return { moved: 0, skipped };
  }
  return { moved: journal.entries.length, skipped };
}

async function undoMoves(): Promise<{ restored: number; skipped: number }> {
  const journal = await readOrganizeUndo();
  if (!journal) return { restored: 0, skipped: 0 };
  let restored = 0;
  let skipped = 0;

  for (const entry of [...journal.entries].reverse()) {
    const node = await getNode(entry.bookmarkId);
    if (!node || node.parentId !== entry.toParentId) {
      skipped += 1;
      continue;
    }
    try {
      const siblings = await chrome.bookmarks.getChildren(entry.fromParentId);
      await chrome.bookmarks.move(entry.bookmarkId, {
        parentId: entry.fromParentId,
        index: Math.min(entry.fromIndex, siblings.length),
      });
      restored += 1;
    } catch {
      skipped += 1;
    }
  }
  await removeEmptyFolders(journal.createdFolderIds ?? []);
  // Never discard a journal written by a newer run.
  if ((await readOrganizeUndo())?.createdAt === journal.createdAt) {
    await chrome.storage.local.remove(ORGANIZE_UNDO_STORAGE_KEY);
  }
  return { restored, skipped };
}

/**
 * Creates the category folders the moves need on the bookmarks bar. A folder with the same
 * title already on the bar is reused, so repeated runs do not stack duplicates.
 */
async function resolveNewFolders(
  moves: OrganizeMove[],
  newFolderTitles: Record<string, string>
): Promise<{ folderIds: Map<string, string>; createdFolderIds: string[] }> {
  const folderIds = new Map<string, string>();
  const createdFolderIds: string[] = [];
  const needed = [...new Set(moves.map((move) => move.toFolderId))].filter(
    (id) => newFolderTitles[id]
  );
  if (!needed.length) return { folderIds, createdFolderIds };
  const bar = await bookmarksBar();
  const children = await chrome.bookmarks.getChildren(bar.id);
  for (const placeholder of needed) {
    const title = newFolderTitles[placeholder];
    const existing = children.find((child) => !child.url && child.title === title);
    if (existing) {
      folderIds.set(placeholder, existing.id);
      continue;
    }
    const created = await chrome.bookmarks.create({ parentId: bar.id, title });
    folderIds.set(placeholder, created.id);
    createdFolderIds.push(created.id);
  }
  return { folderIds, createdFolderIds };
}

async function bookmarksBar(): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const [root] = await chrome.bookmarks.getTree();
  const children = root?.children ?? [];
  const bar =
    children.find((child) => (child as { folderType?: string }).folderType === 'bookmarks-bar') ??
    children[0];
  if (!bar) throw new Error('The bookmarks bar is unavailable');
  return bar;
}

async function removeEmptyFolders(folderIds: string[]): Promise<void> {
  for (const folderId of folderIds) {
    try {
      if (!(await chrome.bookmarks.getChildren(folderId)).length) {
        await chrome.bookmarks.remove(folderId);
      }
    } catch {
      // Already gone or no longer a folder: nothing to clean up.
    }
  }
}

async function getNode(id: string): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  try {
    return (await chrome.bookmarks.get(id))[0];
  } catch {
    return undefined;
  }
}

async function writeJournal(journal: OrganizeUndoJournal): Promise<void> {
  await chrome.storage.local.set({ [ORGANIZE_UNDO_STORAGE_KEY]: journal });
}
