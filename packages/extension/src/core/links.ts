import type { BrowserSavedLinkItem, LinkItem } from '@bookmark-assistant/types';

export interface BookmarkTreeNodeLike {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  children?: BookmarkTreeNodeLike[];
  dateAdded?: number;
  dateGroupModified?: number;
  path?: string;
}

export interface SyncFingerprintItem {
  url: string;
  title: string;
  path: string;
  source?: LinkItem['source'];
  type?: LinkItem['type'];
  readState?: LinkItem['readState'];
  syncId?: string;
}

interface SyncFingerprintCrypto {
  subtle?: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
  };
}

export interface CreateSyncFingerprintOptions {
  crypto?: SyncFingerprintCrypto | null;
}

export interface FormatBookmarkOptions {
  description?: string;
  now?: () => Date;
  createSyncId?: (bookmark: BookmarkTreeNodeLike) => string;
  includeType?: boolean;
}

export interface CollectBookmarkSyncItemsOptions {
  defaultPath?: string;
  now?: () => Date;
  createSyncId?: (bookmark: BookmarkTreeNodeLike) => string;
  getDescription?: (url: string, bookmark: BookmarkTreeNodeLike) => string | Promise<string>;
  includeType?: boolean;
}

export interface CollectedBookmarkSyncItems {
  items: LinkItem[];
  fingerprintItems: SyncFingerprintItem[];
}

export interface FormatSavedLinkInput {
  title?: string;
  url: string;
  description?: string;
  path?: string;
}

export interface FormatSavedLinkOptions {
  now?: () => Date;
  createSyncId?: () => string;
  defaultPath?: string;
  source?: BrowserSavedLinkItem['source'];
}

export type FormatCurrentPageOptions = Omit<FormatSavedLinkOptions, 'source'>;

export function formatBookmarkForSync(
  bookmark: BookmarkTreeNodeLike,
  path: string,
  options: FormatBookmarkOptions = {}
): LinkItem {
  const now = options.now ?? (() => new Date());
  const syncId = options.createSyncId?.(bookmark) ?? createDefaultBookmarkSyncId(bookmark.id);
  const item: LinkItem = {
    title: bookmark.title || 'Untitled',
    url: bookmark.url || '',
    description: options.description ?? '',
    path,
    dateAdded: bookmark.dateAdded
      ? new Date(bookmark.dateAdded).toISOString()
      : now().toISOString(),
    syncId,
    source: 'chrome_bookmark',
  };

  if (options.includeType) {
    item.type = 'bookmark';
  }

  return item;
}

export async function collectBookmarkSyncItems(
  bookmarkNodes: BookmarkTreeNodeLike[],
  options: CollectBookmarkSyncItemsOptions = {}
): Promise<CollectedBookmarkSyncItems> {
  const defaultPath = options.defaultPath ?? 'Bookmarks';
  const items: LinkItem[] = [];
  const fingerprintItems: SyncFingerprintItem[] = [];

  async function traverse(nodes: BookmarkTreeNodeLike[], currentPath: string): Promise<void> {
    for (const node of nodes) {
      if (node.url) {
        const title = node.title || 'Untitled';
        const url = node.url || '';
        const description = (await options.getDescription?.(url, node)) ?? '';

        const item = formatBookmarkForSync(node, currentPath, {
          description,
          now: options.now,
          createSyncId: options.createSyncId,
          includeType: options.includeType,
        });
        items.push(item);

        fingerprintItems.push({
          url,
          title,
          path: currentPath,
          source: item.source,
          type: options.includeType ? 'bookmark' : undefined,
          syncId: item.syncId,
        });
      } else if (node.children) {
        const nextPath = node.title ? `${currentPath} / ${node.title}` : currentPath;
        await traverse(node.children, nextPath);
      }
    }
  }

  await traverse(bookmarkNodes, defaultPath);
  return { items, fingerprintItems };
}

export function withBookmarkType(items: LinkItem[]): LinkItem[] {
  return items.map((item) => ({
    ...item,
    type: 'bookmark',
  }));
}

export function formatSavedLinkForSync(
  input: FormatSavedLinkInput,
  options: FormatSavedLinkOptions = {}
): BrowserSavedLinkItem {
  const now = options.now ?? (() => new Date());
  const syncId = options.createSyncId?.() ?? createDefaultQuickSaveSyncId('quick-save');
  const item: BrowserSavedLinkItem = {
    title: input.title || 'Untitled',
    url: input.url,
    description: input.description ?? '',
    path: input.path ?? options.defaultPath ?? 'Quick Saves',
    dateAdded: now().toISOString(),
    syncId,
  };

  if (options.source) {
    item.source = options.source;
  }

  return item;
}

export function formatCurrentPageForSync(
  input: FormatSavedLinkInput,
  options: FormatCurrentPageOptions = {}
): BrowserSavedLinkItem {
  return formatSavedLinkForSync(input, {
    ...options,
    defaultPath: options.defaultPath ?? 'Saved Pages',
    source: 'current_page',
  });
}

export function toSyncFingerprintItems(
  items: LinkItem[],
  defaultPath = 'Bookmarks'
): SyncFingerprintItem[] {
  return items.map((item) => ({
    url: item.url,
    title: item.title,
    path: item.path || defaultPath,
    source: item.source,
    type: item.type,
    readState: item.readState,
    syncId: item.syncId,
  }));
}

export async function createSyncFingerprint(
  items: SyncFingerprintItem[],
  options: CreateSyncFingerprintOptions = {}
): Promise<string> {
  const fingerprintPayload = items
    .map((item) => `${item.path}|${item.url}|${item.title}`)
    .map((legacyKey, index) => {
      const item = items[index];
      return [
        legacyKey,
        item.type || '',
        item.source || '',
        item.readState || '',
        item.syncId || '',
      ].join('|');
    })
    .sort()
    .join('\n');

  const cryptoProvider = Object.prototype.hasOwnProperty.call(options, 'crypto')
    ? options.crypto
    : globalThis.crypto;

  try {
    if (cryptoProvider?.subtle) {
      const encoded = new TextEncoder().encode(fingerprintPayload);
      const digest = await cryptoProvider.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fall back to the non-crypto hash below when Web Crypto is unavailable or fails.
  }

  return createFallbackSyncFingerprint(fingerprintPayload);
}

function createDefaultBookmarkSyncId(bookmarkId: string): string {
  return `chrome-bookmark-${bookmarkId}`;
}

function createDefaultQuickSaveSyncId(prefix: string): string {
  if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
    return (globalThis.crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }

  return `${prefix}-${Date.now()}`;
}

function createFallbackSyncFingerprint(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16);
}
