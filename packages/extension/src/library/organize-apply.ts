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
  moves: OrganizeMove[]
): Promise<{ moved: number; skipped: number }> {
  return withJournalLock(() => applyMoves(moves));
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

async function applyMoves(moves: OrganizeMove[]): Promise<{ moved: number; skipped: number }> {
  const previous = await readOrganizeUndo();
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
  // Never discard a journal written by a newer run.
  if ((await readOrganizeUndo())?.createdAt === journal.createdAt) {
    await chrome.storage.local.remove(ORGANIZE_UNDO_STORAGE_KEY);
  }
  return { restored, skipped };
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
