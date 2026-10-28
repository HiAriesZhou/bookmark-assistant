// Pure Notion mapping and sync-planning helpers. Copied from the frozen server so the
// extension can sync on its own; keep them free of Chrome APIs, storage and network calls.
export type {
  DiffBookmarksOutcome,
  DiffBookmarksStats,
  ExistingLinkRecord,
  PlannedLinkUpdate,
  ValidateBookmarkOptions,
} from './bookmarks';
export type {
  BuildBookmarkPropertiesOptions,
  ExtractNotionPageFolderAndTagsOptions,
  ExtractNotionPageFolderAndTagsResult,
  ExtractNotionPageLinkKeysResult,
  ExtractNotionPageTimestampsResult,
  NotionPageLike,
  NotionPagePropertiesLike,
  NotionPagePropertyValueLike,
  NotionPropertySchema,
  NotionRichTextFragmentLike,
  NotionSchemaProperty,
} from './notion-properties';
export type { NotionDatabaseLike, NotionDataSourceLike } from './notion-database';
export type { BookmarkSyncResultWithRetryState } from './sync-results';

export {
  diffLinkItems,
  diffBookmarks,
  normalizeBookmarkForSyncPlanning,
  validateBookmarkInput,
} from './bookmarks';
export {
  buildBookmarkPropertiesFromNotionSchema,
  extractNotionPageFolderAndTags,
  extractNotionPageLinkKeys,
  isReadOnlyNotionPropertyType,
} from './notion-properties';
export { getPrimaryNotionDataSourceId, hasNotionDataSourceId } from './notion-database';
export { getNotionRetryDelayMs, isRetryableNotionError } from './notion-retry';
export { mergeRetryResults, selectRetryableSyncFailures } from './sync-results';
export {
  buildGoogleS2FaviconUrl,
  isFetchableHttpUrl,
  isValidUrl,
  normalizeUrlForSync,
} from './urls';
export type { BuildGoogleS2FaviconUrlOptions } from './urls';
