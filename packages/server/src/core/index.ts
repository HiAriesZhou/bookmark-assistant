export type {
  DiffBookmarksOutcome,
  DiffBookmarksStats,
  ExistingLinkRecord,
  PlannedLinkUpdate,
  ValidateBookmarkOptions,
} from './bookmarks';
export type { DescriptionSource, HtmlDescriptionResult } from './descriptions';
export { belongsToSyncTarget, readRichTextProperty } from './sync-enrichment';
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
export type { PersistenceErrorLike } from './persistence';
export type { BookmarkSyncResultWithRetryState } from './sync-results';

export {
  diffLinkItems,
  diffBookmarks,
  normalizeBookmarkForSyncPlanning,
  selectUnsyncedDescribedBookmarks,
  validateBookmarkInput,
  validateLinkItemInput,
} from './bookmarks';
export {
  extractContentFromStructuredElements,
  extractDescriptionFromHtml,
  isValidDescription,
  looksLikeDescription,
  sanitizeDescription,
} from './descriptions';
export {
  buildBookmarkPropertiesFromNotionSchema,
  extractNotionPageFolderAndTags,
  extractNotionPageLinkKeys,
  extractNotionPageTimestamps,
  isReadOnlyNotionPropertyType,
} from './notion-properties';
export { getPrimaryNotionDataSourceId, hasNotionDataSourceId } from './notion-database';
export { isRetryablePersistenceError } from './persistence';
export {
  getNotionErrorStatus,
  getNotionRetryDelayMs,
  isRetryableNotionError,
} from './notion-retry';
export {
  isRetryableSyncError,
  mergeRetryResults,
  selectRetryableSyncFailures,
} from './sync-results';
export {
  buildGoogleS2FaviconUrl,
  isFetchableHttpUrl,
  isValidUrl,
  normalizeUrlForSync,
} from './urls';
export type { BuildGoogleS2FaviconUrlOptions } from './urls';
