export type ReadState = 'UNREAD' | 'READ';

export type LinkItemType = 'bookmark' | 'reading_list';

export type LinkCaptureSource =
  | 'chrome_bookmark'
  | 'reading_list'
  | 'current_page'
  | 'context_menu'
  | 'import';

export interface LinkItem {
  title: string;
  url: string;
  path?: string;
  description?: string;
  tags?: string[];
  dateAdded?: string;
  syncId?: string;
  type?: LinkItemType;
  readState?: ReadState;
  source?: LinkCaptureSource;
}

export type BrowserBookmarkSyncItem = LinkItem & {
  type?: 'bookmark';
  source?: 'chrome_bookmark';
};

export type ReadingListSyncItem = LinkItem & {
  type: 'reading_list';
  readState: ReadState;
  source?: 'reading_list';
};

export type BrowserSavedLinkItem = LinkItem & {
  source?: 'current_page' | 'context_menu';
};

export interface BookmarkSyncOptions {
  batchSize?: number;
  duplicateHandling?: 'update' | 'skip' | 'create_new';
  generateDescriptions?: boolean;
  /** Base writes may finish before optional description and AI enrichment. */
  deferEnhancements?: boolean;
}

export interface BookmarkSyncRequest {
  dataSourceId?: string;
  databaseId?: string;
  bookmarks?: LinkItem[];
  readingList?: LinkItem[];
  items?: LinkItem[];
  options?: BookmarkSyncOptions;
  /** Current-page saves handle AI separately from bulk sync. */
  aiBatchEligible?: boolean;
}

type BookmarkSyncWriteSuccess = {
  success: true;
  bookmark: string;
  syncId?: string;
  notionPageId?: string;
  error?: never;
};

export type BookmarkSyncResult =
  | (BookmarkSyncWriteSuccess & { action: 'created' })
  | (BookmarkSyncWriteSuccess & { action: 'updated' })
  | {
      success: true;
      bookmark: string;
      action: 'skipped';
      reason: 'duplicate_exists';
      syncId?: string;
      notionPageId?: never;
      error?: never;
    }
  | {
      success: false;
      bookmark: string;
      error: string;
      syncId?: string;
      action?: never;
      notionPageId?: never;
    };

export interface BookmarkSyncSummary {
  total: number;
  success: number;
  failed: number;
  batchSize?: number;
  skippedExisting?: number;
  duplicatesBySyncId?: number;
  duplicatesByUrl?: number;
  updated?: number;
  readingListTotal?: number;
  readingListSuccess?: number;
  readingListFailed?: number;
  readingListSkippedExisting?: number;
  descriptionSkippedByBudget?: number;
  deferred?: number;
}

export interface BookmarkSyncResponse {
  success: true;
  results: BookmarkSyncResult[];
  summary: BookmarkSyncSummary;
  aiBatch?: BookmarkSyncAiBatch;
  aiPlanning?: BookmarkSyncAiPlanning;
  enrichment?: BookmarkSyncEnrichmentRequest;
  partialSync?: {
    applied: number;
    requested: number;
    processed: number;
    skipped: number;
    message: string;
  };
}

export interface BookmarkSyncAiBatch {
  id: string;
  status: string;
  eligibleCount: number;
}

export interface BookmarkSyncAiPlanning {
  status: 'planned' | 'not_eligible' | 'failed';
  taskCount?: number;
}

export interface BookmarkSyncEnrichmentItem {
  title: string;
  url: string;
  syncId: string;
  notionPageId: string;
  action: 'created' | 'updated';
  description?: string;
  source?: LinkItem['source'];
}

export interface BookmarkSyncEnrichmentRequest {
  items: BookmarkSyncEnrichmentItem[];
  aiBatchEligible?: boolean;
}

export interface BookmarkSyncEnrichmentResponse {
  success: true;
  summary: {
    total: number;
    generated: number;
    alreadyPresent: number;
    unavailable: number;
    targetSkipped: number;
    failed: number;
  };
  aiBatch?: BookmarkSyncAiBatch;
  aiPlanning: BookmarkSyncAiPlanning;
}

export interface ApiSuccessBody<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ApiErrorBody {
  success?: false;
  error: string;
  message?: string;
  code?: string;
}

export type ApiResponse<T = unknown> = ApiSuccessBody<T> | ApiErrorBody;

export type NotionPropertyType =
  | 'title'
  | 'url'
  | 'rich_text'
  | 'multi_select'
  | 'date'
  | 'select'
  | 'single_select'
  | 'status'
  | string;

export type NotionLinkField =
  | 'title'
  | 'url'
  | 'path'
  | 'description'
  | 'tags'
  | 'dateAdded'
  | 'syncId'
  | 'type'
  | 'source'
  | 'readState';

export interface NotionDatabaseRef {
  dataSourceId?: string;
  databaseId?: string;
}

export interface NotionPropertyMapping {
  linkField: NotionLinkField;
  notionPropertyName?: string;
  notionPropertyType: NotionPropertyType;
  required?: boolean;
}

export interface NotionDatabaseMapping extends NotionDatabaseRef {
  properties: NotionPropertyMapping[];
}

export interface NotionPageProperties {
  Title?: {
    title: { text: { content: string } }[];
  };
  URL?: {
    url: string;
  };
  Folder?: {
    rich_text: { text: { content: string } }[];
  };
  Tags?: {
    multi_select: { name: string }[];
  };
  Description?: {
    rich_text: { text: { content: string } }[];
  };
  'Date Added'?: {
    date: { start: string };
  };
  'Sync ID'?: {
    rich_text: { text: { content: string } }[];
  };
  Type?: {
    select?: { name: string };
    single_select: { name: string };
  };
  Source?: {
    select?: { name: string };
    single_select?: { name: string };
  };
  'Read State'?: {
    status: { name: string };
  };
}

export type ContextItemKind = 'link';

export interface ContextItemMetadata {
  description?: string;
  path?: string;
  dateAdded?: string;
  syncId?: string;
  readState?: ReadState;
  tags?: string[];
}

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  title: string;
  url: string;
  source: LinkCaptureSource;
  content?: string;
  metadata?: ContextItemMetadata;
  createdAt: string;
  updatedAt?: string;
}

export interface ContextItemExport {
  version: 1;
  exportedAt: string;
  items: ContextItem[];
}
