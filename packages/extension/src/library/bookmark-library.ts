import { normalizeUrl } from '../core';
import type { LocalBookmarkMetadataV1 } from './bookmark-metadata';

export interface LocalBookmark {
  id: string;
  parentId?: string;
  title: string;
  url: string;
  dateAdded?: number;
  folderPath: string;
  isTopLevel: boolean;
  metadata: LocalBookmarkMetadataV1;
  duplicateCount: number;
}

export interface LocalBookmarkFolder {
  id: string;
  title: string;
  path: string;
  depth: number;
}

export interface LocalBookmarkIndex {
  bookmarks: LocalBookmark[];
  folders: LocalBookmarkFolder[];
  tags: Array<{ name: string; count: number }>;
  duplicateGroups: Array<{ key: string; bookmarks: LocalBookmark[] }>;
}

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'untagged' }
  | { kind: 'duplicates' }
  | { kind: 'uncategorized' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'tag'; tag: string };

export type LibrarySort = 'date-asc' | 'date-desc' | 'title-asc' | 'title-desc';

const EMPTY_METADATA: LocalBookmarkMetadataV1 = {
  tags: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function buildLocalBookmarkIndex(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  metadataByBookmarkId: Record<string, LocalBookmarkMetadataV1>
): LocalBookmarkIndex {
  const bookmarks: LocalBookmark[] = [];
  const folders: LocalBookmarkFolder[] = [];
  const rootContainerIds = new Set(
    tree.flatMap((root) =>
      (root.children ?? []).filter((child) => !child.url).map((child) => child.id)
    )
  );

  const visit = (node: chrome.bookmarks.BookmarkTreeNode, path: string[], isRoot: boolean) => {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        url: node.url,
        dateAdded: node.dateAdded,
        folderPath: path.join(' / '),
        isTopLevel: Boolean(node.parentId && rootContainerIds.has(node.parentId)),
        metadata: metadataByBookmarkId[node.id] ?? EMPTY_METADATA,
        duplicateCount: 1,
      });
      return;
    }

    const nextPath = isRoot || !node.title ? path : [...path, node.title];
    if (!isRoot) {
      folders.push({
        id: node.id,
        title: node.title,
        path: nextPath.join(' / '),
        depth: Math.max(0, nextPath.length - 1),
      });
    }
    for (const child of node.children ?? []) visit(child, nextPath, false);
  };

  for (const root of tree) visit(root, [], !root.parentId);

  const byCanonicalUrl = new Map<string, LocalBookmark[]>();
  for (const bookmark of bookmarks) {
    const key = normalizeUrl(bookmark.url);
    const group = byCanonicalUrl.get(key) ?? [];
    group.push(bookmark);
    byCanonicalUrl.set(key, group);
  }

  const duplicateGroups = [...byCanonicalUrl.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      for (const bookmark of group) bookmark.duplicateCount = group.length;
      return { key, bookmarks: group };
    })
    .sort((left, right) => right.bookmarks.length - left.bookmarks.length);

  const tagCounts = new Map<string, { name: string; count: number }>();
  for (const bookmark of bookmarks) {
    for (const tag of bookmark.metadata.tags) {
      const key = tag.toLocaleLowerCase();
      const current = tagCounts.get(key);
      tagCounts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }

  bookmarks.sort((left, right) => (right.dateAdded ?? 0) - (left.dateAdded ?? 0));
  // Keep Chrome's depth-first order so each folder is followed by its descendants.

  return {
    bookmarks,
    folders,
    tags: [...tagCounts.values()].sort(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name)
    ),
    duplicateGroups,
  };
}

export function filterLocalBookmarks(
  bookmarks: LocalBookmark[],
  filter: LibraryFilter,
  query: string
): LocalBookmark[] {
  const needle = query.trim().toLocaleLowerCase();
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;

  return bookmarks.filter((bookmark) => {
    if (filter.kind === 'recent' && (bookmark.dateAdded ?? 0) < recentCutoff) return false;
    if (filter.kind === 'untagged' && bookmark.metadata.tags.length > 0) return false;
    if (filter.kind === 'duplicates' && bookmark.duplicateCount < 2) return false;
    if (filter.kind === 'uncategorized' && !bookmark.isTopLevel) return false;
    if (filter.kind === 'folder' && bookmark.parentId !== filter.folderId) return false;
    if (
      filter.kind === 'tag' &&
      !bookmark.metadata.tags.some(
        (tag) => tag.toLocaleLowerCase() === filter.tag.toLocaleLowerCase()
      )
    ) {
      return false;
    }
    if (!needle) return true;
    return [
      bookmark.title,
      bookmark.url,
      bookmark.folderPath,
      bookmark.metadata.description ?? '',
      ...bookmark.metadata.tags,
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

export function sortLocalBookmarks(
  bookmarks: LocalBookmark[],
  sort: LibrarySort,
  locale = 'en'
): LocalBookmark[] {
  const sorted = [...bookmarks];
  if (sort === 'date-asc' || sort === 'date-desc') {
    return sorted.sort((left, right) => {
      if (left.dateAdded === undefined) return right.dateAdded === undefined ? 0 : 1;
      if (right.dateAdded === undefined) return -1;
      return sort === 'date-asc'
        ? left.dateAdded - right.dateAdded
        : right.dateAdded - left.dateAdded;
    });
  }
  return sorted.sort((left, right) => {
    const comparison = (left.title || left.url).localeCompare(right.title || right.url, locale, {
      sensitivity: 'base',
    });
    return sort === 'title-asc' ? comparison : -comparison;
  });
}

export function getBookmarkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
