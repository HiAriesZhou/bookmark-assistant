/**
 * Reading List Utility
 * Provides utilities for interacting with Chrome's Reading List API (Chrome 120+)
 */

import {
  formatReadingListItemsForSync,
  type BookmarkTreeNodeLike,
  type ChromeReadingListItemLike,
} from '../core';

export type ReadingListItem = ReturnType<typeof formatReadingListItemsForSync>[number];

// Chrome API type augmentation for readingList (Chrome 120+)
interface ChromeWithReadingList {
  readingList?: {
    query?(queryInfo: ReadingListQueryInfo): Promise<ChromeReadingListItemLike[]>;
  };
}

interface ReadingListQueryInfo {
  hasBeenRead?: boolean;
  title?: string;
  url?: string;
}

interface ReadingListDebugInfo {
  checkedAt: string;
  manifestVersion?: string;
  hasReadingListPermission?: boolean;
  apiAvailable: boolean;
  queryAllCount?: number;
  queryUnreadCount?: number;
  queryReadCount?: number;
  bookmarkTreeFallbackCount?: number;
  bookmarkTreeCandidateFolderCount?: number;
  returnedCount: number;
  errors: Array<{ step: string; category: 'unavailable' | 'query' | 'fallback' | 'storage' }>;
}

export interface GetReadingListItemsOptions {
  fallbackBookmarkTree?: BookmarkTreeNodeLike[];
}

const READING_LIST_FOLDER_TITLES = new Set([
  'reading list',
  'read later',
  'readinglist',
  '阅读清单',
  '阅读列表',
  '稍后阅读',
]);

/**
 * Get items from Chrome's Reading List API
 *
 * @returns Array of reading list items mapped to a consistent format
 */
export async function getReadingListItems(
  options: GetReadingListItemsOptions = {}
): Promise<ReadingListItem[]> {
  // Cast chrome to access readingList API (Chrome 120+)
  const chromeWithReadingList = chrome as ChromeWithReadingList;
  const manifest = getExtensionManifest();
  const readingListApi = chromeWithReadingList.readingList;
  const debug: ReadingListDebugInfo = {
    checkedAt: new Date().toISOString(),
    manifestVersion: manifest?.version,
    hasReadingListPermission: (manifest?.permissions as string[] | undefined)?.includes(
      'readingList'
    ),
    apiAvailable: Boolean(chromeWithReadingList.readingList?.query),
    returnedCount: 0,
    errors: [],
  };

  try {
    let items: ChromeReadingListItemLike[] = [];

    if (readingListApi?.query) {
      try {
        // Call query directly on readingListApi to avoid "Illegal invocation" caused by .bind()
        // on Chrome APIs where methods are getters returning pre-bound native functions.
        const query = (queryInfo: ReadingListQueryInfo) => readingListApi!.query!(queryInfo);
        items = await queryReadingListEntries(query, debug);
      } catch {
        console.warn(
          '[Reading List] Failed to query readingList API, using bookmark tree fallback.'
        );
        debug.errors.push({ step: 'query-reading-list-api', category: 'query' });
      }
    } else {
      console.warn('[Reading List] API not available. Chrome 120+ required.');
    }

    if (items.length === 0) {
      items = await getReadingListItemsFromBookmarkTree(debug, options.fallbackBookmarkTree);
    }

    debug.returnedCount = items.length;
    await persistReadingListDebugInfo(debug);
    console.log(`[Reading List] Retrieved ${items.length} items from Chrome Reading List`);
    return formatReadingListItemsForSync(items);
  } catch {
    console.warn('[Reading List] Failed to get reading list items.');
    debug.errors.push({ step: 'get-reading-list-items', category: 'unavailable' });
    await persistReadingListDebugInfo(debug);
    return [];
  }
}

async function queryReadingListEntries(
  query: (queryInfo: ReadingListQueryInfo) => Promise<ChromeReadingListItemLike[]>,
  debug?: ReadingListDebugInfo
): Promise<ChromeReadingListItemLike[]> {
  const allItems = await query({});
  if (debug) {
    debug.queryAllCount = allItems.length;
  }
  if (allItems.length > 0) {
    return allItems;
  }

  const [unreadItems, readItems] = await Promise.all([
    query({ hasBeenRead: false }),
    query({ hasBeenRead: true }),
  ]);
  if (debug) {
    debug.queryUnreadCount = unreadItems.length;
    debug.queryReadCount = readItems.length;
  }
  const merged = mergeReadingListItems([...unreadItems, ...readItems]);
  if (merged.length === 0) {
    console.warn(
      '[Reading List] chrome.readingList.query returned 0 items for all/read/unread queries.'
    );
  }
  return merged;
}

function mergeReadingListItems(items: ChromeReadingListItemLike[]): ChromeReadingListItemLike[] {
  const byUrl = new Map<string, ChromeReadingListItemLike>();
  for (const item of items) {
    const url = typeof item.url === 'string' ? item.url : item.url.url;
    if (!byUrl.has(url)) {
      byUrl.set(url, item);
    }
  }
  return [...byUrl.values()];
}

async function getReadingListItemsFromBookmarkTree(
  debug?: ReadingListDebugInfo,
  suppliedTree?: BookmarkTreeNodeLike[]
): Promise<ChromeReadingListItemLike[]> {
  if (!suppliedTree && !chrome.bookmarks?.getTree) {
    return [];
  }

  try {
    const tree = suppliedTree ?? ((await chrome.bookmarks.getTree()) as BookmarkTreeNodeLike[]);
    const candidateFolderCount = countReadingListCandidateFolders(tree);
    const items = collectReadingListBookmarkItems(tree);
    if (debug) {
      debug.bookmarkTreeFallbackCount = items.length;
      debug.bookmarkTreeCandidateFolderCount = candidateFolderCount;
    }
    if (items.length > 0) {
      console.warn(
        `[Reading List] chrome.readingList.query returned no items; using ${items.length} item(s) from the bookmark tree Reading List folder.`
      );
    }
    return items;
  } catch {
    console.warn('[Reading List] Failed to inspect bookmark tree fallback.');
    debug?.errors.push({ step: 'bookmark-tree-fallback', category: 'fallback' });
    return [];
  }
}

function collectReadingListBookmarkItems(
  nodes: BookmarkTreeNodeLike[]
): ChromeReadingListItemLike[] {
  const items: ChromeReadingListItemLike[] = [];
  const stack = nodes.map((node) => ({ node, insideReadingListFolder: false }));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { node, insideReadingListFolder } = current;
    const nextInsideReadingListFolder =
      insideReadingListFolder || (!node.url && isReadingListFolderTitle(node.title || ''));
    if (node.url && nextInsideReadingListFolder) {
      items.push({
        title: node.title || 'Untitled',
        url: node.url,
        creationTime: node.dateAdded,
        hasBeenRead: false,
      });
    }
    for (const child of node.children ?? []) {
      stack.push({ node: child, insideReadingListFolder: nextInsideReadingListFolder });
    }
  }
  return mergeReadingListItems(items);
}

function isReadingListFolderTitle(title: string): boolean {
  const normalizedTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return READING_LIST_FOLDER_TITLES.has(normalizedTitle);
}

function countReadingListCandidateFolders(nodes: BookmarkTreeNodeLike[]): number {
  let count = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (!node.url && isReadingListFolderTitle(node.title || '')) {
      count += 1;
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return count;
}

async function persistReadingListDebugInfo(debug: ReadingListDebugInfo) {
  console.log('[Reading List] Debug info:', debug);
  try {
    if (chrome.storage?.local?.set) {
      await chrome.storage.local.set({ last_reading_list_debug: debug });
    }
  } catch {
    console.warn('[Reading List] Failed to persist aggregate debug info.');
  }
}

function getExtensionManifest(): chrome.runtime.Manifest | undefined {
  try {
    if (typeof chrome.runtime?.getManifest !== 'function') {
      return undefined;
    }
    return chrome.runtime.getManifest();
  } catch {
    console.warn('[Reading List] Failed to read extension manifest.');
    return undefined;
  }
}
