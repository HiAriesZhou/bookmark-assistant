import {
  removeBookmarkMetadata,
  saveBookmarkMetadata,
  type LocalBookmarkMetadataInput,
} from './bookmark-metadata';
import type { LocalBookmark } from './bookmark-library';

export interface BookmarkChanges extends LocalBookmarkMetadataInput {
  title: string;
  url: string;
  parentId?: string;
}

export async function saveBookmarkChanges(
  bookmark: LocalBookmark,
  changes: BookmarkChanges
): Promise<void> {
  const title = changes.title.trim();
  const url = changes.url.trim();
  if (!url) throw new Error('BOOKMARK_URL_REQUIRED');

  if (title !== bookmark.title || url !== bookmark.url) {
    await chrome.bookmarks.update(bookmark.id, { title, url });
  }
  if (changes.parentId && changes.parentId !== bookmark.parentId) {
    await chrome.bookmarks.move(bookmark.id, { parentId: changes.parentId });
  }
  await saveBookmarkMetadata(bookmark.id, {
    description: changes.description,
    tags: changes.tags,
  });
}

/** Metadata is removed only after Chrome confirms the destructive operation. */
export async function deleteBookmark(bookmarkId: string): Promise<void> {
  await chrome.bookmarks.remove(bookmarkId);
  await removeBookmarkMetadata(bookmarkId);
}
