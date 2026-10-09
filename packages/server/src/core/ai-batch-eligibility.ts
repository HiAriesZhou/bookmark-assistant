import type { BookmarkItem } from '../types';

const BATCH_AI_SOURCES = new Set<NonNullable<BookmarkItem['source']>>([
  'chrome_bookmark',
  'reading_list',
]);

/**
 * Batch AI is only for bulk browser sources. Current-page and context-menu
 * captures have explicit flows and must never become batch tasks by accident.
 */
export function isBatchAiEligibleCapture(
  requested: boolean | undefined,
  items: Array<Pick<BookmarkItem, 'source'>>
): boolean {
  return (
    requested !== false &&
    items.length > 0 &&
    items.every((item) => item.source !== undefined && BATCH_AI_SOURCES.has(item.source))
  );
}
