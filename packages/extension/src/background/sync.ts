import {
  buildBookmarkPath,
  createDefaultKnowledgeItemId,
  flattenBookmarks,
  normalizeUrl,
  prepareLegacyLinkItemForSync,
  type BookmarkTreeNodeLike,
} from '../core';
import { serverAPI } from './server-api';

export type BookmarkItem = BookmarkTreeNodeLike;

export { buildBookmarkPath, flattenBookmarks };

function addPathsToBookmarks(
  bookmarks: BookmarkItem[],
  bookmarkTree: chrome.bookmarks.BookmarkTreeNode[]
): BookmarkItem[] {
  return bookmarks.map((bookmark) => ({
    ...bookmark,
    path: buildBookmarkPath(bookmarkTree, bookmark.id),
  }));
}

export async function syncAllBookmarksToNotion() {
  try {
    const bookmarkTree = await chrome.bookmarks.getTree();

    // Flatten bookmark tree and filter URLs only
    const flatBookmarks = flattenBookmarks(bookmarkTree).filter((bookmark) => bookmark.url);
    // Add paths to bookmarks for better organization in Notion
    const bookmarks = addPathsToBookmarks(flatBookmarks, bookmarkTree);
    if (bookmarks.length === 0) {
      throw new Error('No bookmarks found to sync');
    }

    // NOTE: We no longer check is_pro from local storage
    // Pro status is now validated securely on the server side using database state
    // User cannot bypass limits by modifying local storage

    // Delegate the bulk sync entirely to the server
    const formatted = bookmarks
      .filter((b) => !!b.url)
      .map((b) => ({
        title: b.title || 'Untitled',
        url: b.url || '',
        description: '',
        path: buildBookmarkPath(bookmarkTree, b.id),
        dateAdded: b.dateAdded ? new Date(b.dateAdded).toISOString() : new Date().toISOString(),
        syncId: `chrome-bookmark-${b.id}`,
        source: 'chrome_bookmark' as const,
      }))
      .map((bookmark) => {
        const prepared = prepareLegacyLinkItemForSync(bookmark, {
          now: () => new Date(),
          createId: createDefaultKnowledgeItemId,
          normalizeUrl,
        });
        if (!prepared.success) {
          throw new Error('Chrome bookmark capture cannot be synced');
        }
        return prepared.item;
      });
    const result = await serverAPI.syncBookmarks(formatted);

    // Store sync results metadata only
    await chrome.storage.local.set({
      last_bulk_sync: new Date().toISOString(),
      last_sync_results: result.summary,
      sync_in_progress: false,
    });

    return result.summary;
  } catch (error: any) {
    console.error('❌ Bulk bookmark sync failed:', error);

    throw error;
  }
}
