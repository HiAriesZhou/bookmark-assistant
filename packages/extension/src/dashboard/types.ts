import type { BookmarkLibraryHealth } from './library-health';

export type DashboardConnectionStatus = 'checking' | 'connected' | 'degraded' | 'disconnected';

export type DashboardSyncResult =
  | 'success'
  | 'no_changes'
  | 'partial_failure'
  | 'failed'
  | 'limited';

export type DashboardEventKind =
  | 'connection_checked'
  | 'sync_started'
  | 'sync_completed'
  | 'save_completed'
  | 'error';

export interface DashboardEvent {
  id: string;
  occurredAt: string;
  kind: DashboardEventKind;
  result?: DashboardSyncResult;
  trigger?: 'manual' | 'auto';
  source?: 'current_page' | 'context_menu';
  counts?: {
    total?: number;
    success?: number;
    failed?: number;
    skipped?: number;
  };
  errorCategory?: 'network' | 'authentication' | 'notion_access' | 'rate_limit' | 'unknown';
  action?: 'connect' | 'reconnect' | 'retry';
}

export interface DashboardSnapshot {
  generatedAt: string;
  connection: {
    provider?: {
      id: string;
      displayName: string;
    };
    status: DashboardConnectionStatus;
    workspaceName?: string;
    databaseName?: string;
    checkedAt?: string;
    action?: 'connect' | 'reconnect' | 'retry';
  };
  library: {
    bookmarks: number;
    readingList: number;
    savedToday: number;
    duplicatesSkipped: number;
  };
  libraryHealth: BookmarkLibraryHealth;
  sync: {
    inProgress: boolean;
    lastSyncAt?: string;
    lastResult?: DashboardSyncResult;
    nextAutoSyncAt?: string;
    autoSyncEnabled: boolean;
    failedCount: number;
    enrichment?: SyncEnrichmentStatus;
  };
  recentActivity: DashboardEvent[];
}

export interface SyncEnrichmentStatus {
  status: 'pending' | 'processing' | 'retrying' | 'completed';
  total: number;
  updatedAt: string;
  completedAt?: string;
  generated?: number;
  alreadyPresent?: number;
  unavailable?: number;
  targetSkipped?: number;
  failed?: number;
  aiPlanning?: { status: 'planned' | 'not_eligible' | 'failed'; taskCount?: number };
  lastError?: string;
}

export interface StoredSyncSummary {
  result: DashboardSyncResult;
  completedAt: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
}
