import type { LinkCaptureSource, LinkItem } from '@bookmark-assistant/types';

export interface DiffBookmarksStats {
  requestTotal: number;
  existingIndexSize: number;
  matchedBySyncId: number;
  matchedByUrl: number;
  matchedByTypedUrl?: number;
  updatesNeeded?: number;
}

export interface DiffBookmarksOutcome {
  toCreate: LinkItem[];
  toUpdate?: PlannedLinkUpdate[];
  skippedExisting: number;
  stats: DiffBookmarksStats;
}

export interface ExistingLinkRecord {
  pageId?: string;
  url?: string;
  syncId?: string;
  type?: LinkItem['type'];
  readState?: LinkItem['readState'];
}

export interface PlannedLinkUpdate {
  pageId: string;
  item: LinkItem;
}

export interface ValidateBookmarkOptions {
  now?: () => Date;
  createSyncId?: () => string;
}

export function selectUnsyncedDescribedBookmarks(
  bookmarks: readonly LinkItem[],
  existingUrls: readonly string[],
  existingSyncIds: readonly string[]
): LinkItem[] {
  const existingUrlSet = new Set(existingUrls);
  const existingSyncIdSet = new Set(existingSyncIds);

  return bookmarks.filter((bookmark) => {
    if (!bookmark.description?.trim()) {
      return false;
    }

    return !(
      (bookmark.url && existingUrlSet.has(bookmark.url)) ||
      (bookmark.syncId && existingSyncIdSet.has(bookmark.syncId))
    );
  });
}

export function normalizeBookmarkForSyncPlanning(bookmark: LinkItem): LinkItem {
  const normalized: LinkItem = {
    title: bookmark.title,
    url: bookmark.url,
  };

  if (bookmark.path !== undefined) {
    normalized.path = bookmark.path;
  }
  if (bookmark.description !== undefined) {
    normalized.description = bookmark.description;
  }
  if (bookmark.tags !== undefined) {
    normalized.tags = [...bookmark.tags];
  }
  if (bookmark.dateAdded !== undefined) {
    normalized.dateAdded = bookmark.dateAdded;
  }
  if (bookmark.syncId !== undefined) {
    normalized.syncId = bookmark.syncId;
  }
  if (bookmark.type !== undefined) {
    normalized.type = bookmark.type;
  }
  if (bookmark.readState !== undefined) {
    normalized.readState = bookmark.readState;
  }
  if (bookmark.source !== undefined) {
    normalized.source = bookmark.source;
  }

  return normalized;
}

export function diffBookmarks(
  accepted: LinkItem[],
  existingUrls: readonly string[],
  existingSyncIds: readonly string[]
): DiffBookmarksOutcome {
  let duplicateCount = 0;
  let matchedBySyncId = 0;
  let matchedByUrl = 0;

  const toCreate: LinkItem[] = [];
  for (const item of accepted) {
    let isDuplicate = false;

    if (item.syncId && existingSyncIds.includes(item.syncId)) {
      isDuplicate = true;
      matchedBySyncId++;
    } else if (item.url && existingUrls.includes(item.url)) {
      isDuplicate = true;
      matchedByUrl++;
    }

    if (isDuplicate) {
      duplicateCount++;
    } else {
      toCreate.push(item);
    }
  }

  return {
    toCreate,
    skippedExisting: accepted.length - toCreate.length,
    stats: {
      requestTotal: accepted.length,
      existingIndexSize: duplicateCount,
      matchedBySyncId,
      matchedByUrl,
    },
  };
}

export function diffLinkItems(
  accepted: LinkItem[],
  existingRecords: readonly ExistingLinkRecord[],
  fallbackExistingUrls: readonly string[] = [],
  fallbackExistingSyncIds: readonly string[] = []
): DiffBookmarksOutcome {
  if (existingRecords.length === 0) {
    return diffBookmarks(accepted, fallbackExistingUrls, fallbackExistingSyncIds);
  }

  const bySyncId = new Map<string, ExistingLinkRecord>();
  const byTypedUrl = new Map<string, ExistingLinkRecord>();
  const byBookmarkUrl = new Map<string, ExistingLinkRecord>();

  for (const record of existingRecords) {
    if (record.syncId) {
      bySyncId.set(record.syncId, record);
    }
    if (record.url) {
      byTypedUrl.set(linkRecordKey(record.url, normalizeLinkType(record.type)), record);
      if (normalizeLinkType(record.type) === 'bookmark') {
        byBookmarkUrl.set(record.url, record);
      }
    }
  }

  const toCreate: LinkItem[] = [];
  const toUpdate: PlannedLinkUpdate[] = [];
  let skippedExisting = 0;
  let matchedBySyncId = 0;
  let matchedByUrl = 0;
  let matchedByTypedUrl = 0;

  for (const item of accepted) {
    const type = normalizeLinkType(item.type);
    const syncMatch = item.syncId ? bySyncId.get(item.syncId) : undefined;
    const typedUrlMatch = item.url ? byTypedUrl.get(linkRecordKey(item.url, type)) : undefined;
    const legacyBookmarkUrlMatch =
      item.url && type === 'bookmark' ? byBookmarkUrl.get(item.url) : undefined;
    const existing = syncMatch || typedUrlMatch || legacyBookmarkUrlMatch;

    if (!existing) {
      toCreate.push(item);
      continue;
    }

    skippedExisting++;
    if (syncMatch) {
      matchedBySyncId++;
    } else if (typedUrlMatch) {
      matchedByTypedUrl++;
    } else {
      matchedByUrl++;
    }

    if (existing.pageId && shouldUpdateExistingLink(item, existing)) {
      toUpdate.push({ pageId: existing.pageId, item });
    }
  }

  return {
    toCreate,
    toUpdate,
    skippedExisting,
    stats: {
      requestTotal: accepted.length,
      existingIndexSize: existingRecords.length,
      matchedBySyncId,
      matchedByUrl,
      matchedByTypedUrl,
      updatesNeeded: toUpdate.length,
    },
  };
}

export function validateBookmarkInput(
  bookmark: unknown,
  options: ValidateBookmarkOptions = {}
): LinkItem {
  return validateLinkItemInput(bookmark, options);
}

export function validateLinkItemInput(
  item: unknown,
  options: ValidateBookmarkOptions = {}
): LinkItem {
  const input = isRecord(item) ? item : {};
  const now = options.now ?? (() => new Date());
  const createSyncId = options.createSyncId ?? (() => `bookmark-${Date.now()}`);
  const type = input.type === 'bookmark' || input.type === 'reading_list' ? input.type : undefined;
  const readState =
    input.readState === 'READ' || input.readState === 'UNREAD' ? input.readState : undefined;
  const source = toLinkCaptureSource(input.source);

  const validated: LinkItem = {
    title: stringOr(input.title, stringOr(input.name, 'Untitled Bookmark')),
    url: stringOr(input.url, ''),
    path: optionalString(input.path),
    description: stringOr(input.description, ''),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    dateAdded: stringOr(input.dateAdded, stringOr(input.dateCreated, now().toISOString())),
    syncId: stringOr(input.syncId, createSyncId()),
  };

  if (type) {
    validated.type = type;
  }
  if (readState) {
    validated.readState = readState;
  }
  if (source) {
    validated.source = source;
  }

  return validated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toLinkCaptureSource(value: unknown): LinkCaptureSource | undefined {
  switch (value) {
    case 'chrome_bookmark':
    case 'reading_list':
    case 'current_page':
    case 'context_menu':
    case 'import':
      return value;
    default:
      return undefined;
  }
}

function normalizeLinkType(type: LinkItem['type'] | undefined): LinkItem['type'] {
  return type === 'reading_list' ? 'reading_list' : 'bookmark';
}

function linkRecordKey(url: string, type: LinkItem['type']): string {
  return `${type || 'bookmark'}\n${url}`;
}

function shouldUpdateExistingLink(item: LinkItem, existing: ExistingLinkRecord): boolean {
  const itemType = normalizeLinkType(item.type);

  if (existing.type !== itemType) {
    return true;
  }

  return (
    itemType === 'reading_list' &&
    (item.readState !== undefined && item.readState !== existing.readState)
  );
}
