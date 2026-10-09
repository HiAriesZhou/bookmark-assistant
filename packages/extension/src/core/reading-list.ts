import type { ReadingListSyncItem, ReadState } from '@bookmark-assistant/types';

export interface ChromeReadingListItemLike {
  title: string | { content: string };
  url: string | { url: string };
  creationTime?: number;
  dateAdded?: number;
  hasBeenRead?: boolean;
  readState?: { state: ReadState };
}

export interface FormatReadingListItemOptions {
  now?: () => Date;
  createSyncId?: (item: ChromeReadingListItemLike, index: number) => string;
}

export function formatReadingListItemForSync(
  item: ChromeReadingListItemLike,
  options: FormatReadingListItemOptions = {},
  index = 0
): ReadingListSyncItem {
  const now = options.now ?? (() => new Date());
  const readState: ReadState = item.readState?.state ?? (item.hasBeenRead ? 'READ' : 'UNREAD');
  const url = normalizeReadingListUrl(item.url);

  return {
    title: normalizeReadingListTitle(item.title),
    url,
    path: 'Reading List',
    dateAdded: new Date(item.creationTime ?? item.dateAdded ?? now().getTime()).toISOString(),
    readState,
    syncId: options.createSyncId?.(item, index) ?? createDefaultReadingListSyncId(url),
    type: 'reading_list',
    source: 'reading_list',
  };
}

export function formatReadingListItemsForSync(
  items: ChromeReadingListItemLike[],
  options: FormatReadingListItemOptions = {}
): ReadingListSyncItem[] {
  return items.map((item, index) => formatReadingListItemForSync(item, options, index));
}

function normalizeReadingListTitle(title: ChromeReadingListItemLike['title']): string {
  return typeof title === 'string' ? title : title.content;
}

function normalizeReadingListUrl(url: ChromeReadingListItemLike['url']): string {
  return typeof url === 'string' ? url : url.url;
}

function createDefaultReadingListSyncId(url: string): string {
  return `reading-list-${hashString(url)}`;
}

function hashString(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16);
}
