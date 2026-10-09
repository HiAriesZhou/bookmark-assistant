import type { LinkItem } from '@bookmark-assistant/types';
import type { BookmarkTreeNodeLike } from '../core';
import { normalizeUrl } from '../core';

export interface BookmarkLibraryHealth {
  version: 1;
  bookmarkCount: number;
  userFolderCount: number;
  readingListCount: number;
  duplicateGroupCount: number;
  duplicateExtraItemCount: number;
  topLevelUncategorizedCount: number;
  largestFolderItemCount: number;
  estimatedLocalSyncItems: number;
}

interface TraversalFrame {
  node: BookmarkTreeNodeLike;
  visited: boolean;
}

/**
 * Computes aggregate bookmark-library health without retaining titles, folder
 * names, URLs, or identifiers in the returned view model.
 */
export function analyzeBookmarkLibrary(
  bookmarkTree: BookmarkTreeNodeLike[],
  readingListItems: Pick<LinkItem, 'url'>[] = []
): BookmarkLibraryHealth {
  const virtualRootIds = new Set(bookmarkTree.filter((node) => !node.url).map((node) => node.id));
  const rootContainerIds = new Set<string>();
  for (const root of bookmarkTree) {
    for (const child of root.children ?? []) {
      if (!child.url) rootContainerIds.add(child.id);
    }
  }
  const systemFolderIds = new Set([...virtualRootIds, ...rootContainerIds]);
  const folderDescendantCounts = new Map<string, number>();
  const normalizedUrlCounts = new Map<string, number>();
  const readingListUrls = new Set(readingListItems.map((item) => item.url));
  const stack: TraversalFrame[] = bookmarkTree.map((node) => ({ node, visited: false }));

  let bookmarkCount = 0;
  let userFolderCount = 0;
  let topLevelUncategorizedCount = 0;
  let bookmarkItemsExcludedByReadingList = 0;
  let largestFolderItemCount = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, visited } = frame;

    if (node.url) {
      bookmarkCount += 1;
      if (node.parentId && rootContainerIds.has(node.parentId)) {
        topLevelUncategorizedCount += 1;
      }
      if (readingListUrls.has(node.url)) bookmarkItemsExcludedByReadingList += 1;
      const normalized = normalizeUrl(node.url);
      normalizedUrlCounts.set(normalized, (normalizedUrlCounts.get(normalized) ?? 0) + 1);
      continue;
    }

    if (!visited) {
      if (!systemFolderIds.has(node.id)) userFolderCount += 1;
      stack.push({ node, visited: true });
      for (const child of node.children ?? []) stack.push({ node: child, visited: false });
      continue;
    }

    let descendantUrlCount = 0;
    for (const child of node.children ?? []) {
      descendantUrlCount += child.url ? 1 : (folderDescendantCounts.get(child.id) ?? 0);
    }
    folderDescendantCounts.set(node.id, descendantUrlCount);
    if (!systemFolderIds.has(node.id)) {
      largestFolderItemCount = Math.max(largestFolderItemCount, descendantUrlCount);
    }
  }

  let duplicateGroupCount = 0;
  let duplicateExtraItemCount = 0;
  for (const count of normalizedUrlCounts.values()) {
    if (count > 1) {
      duplicateGroupCount += 1;
      duplicateExtraItemCount += count - 1;
    }
  }

  return {
    version: 1,
    bookmarkCount,
    userFolderCount,
    readingListCount: readingListItems.length,
    duplicateGroupCount,
    duplicateExtraItemCount,
    topLevelUncategorizedCount,
    largestFolderItemCount,
    estimatedLocalSyncItems:
      bookmarkCount - bookmarkItemsExcludedByReadingList + readingListItems.length,
  };
}
