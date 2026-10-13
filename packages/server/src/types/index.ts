// 📝 Type Definitions for Bookmark Notion Sync Server

import { Request } from 'express';

export interface UserData {
  id?: string; // Internal ID (CUID)
  userId: string; // Notion User ID (Legacy name, maps to notionUserId)
  email?: string; // Required for new schema
  notionAccessToken: string;
  notionRefreshToken?: string;
  databases?: any[];
  templateDatabaseId?: string;
  notionDatabaseId?: string;
  notionDataSourceId?: string;
  notionWorkspaceId?: string;
  notionWorkspaceName?: string;
  notionDatabaseName?: string;
  botId?: string;
  duplicatedTemplateId?: string;
  lastActivity: Date;
  plan?: string;
  subscriptionSource?: string | null;
  expiresAt?: Date | null;
  purchaseType?: string; // 'monthly' | 'yearly'
  paddleSubscriptionId?: string;
  paddleCustomerId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
  };
}

export type {
  LinkItem as BookmarkItem,
  BookmarkSyncOptions,
  BookmarkSyncRequest,
  BookmarkSyncEnrichmentItem,
  BookmarkSyncEnrichmentRequest,
} from '@bookmark-assistant/types';

export interface OAuthExchangeRequest {
  code: string;
  extensionUserId?: string;
  templateDatabaseId?: string;
  redirectUri?: string;
}

export interface DatabaseQueryRequest {
  // Prefer dataSourceId with 2025-09-03
  dataSourceId?: string;
  // Back-compat
  databaseId?: string;
  filter?: any;
  sorts?: any[];
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  userId: string;
  details?: Record<string, any>;
}

export interface NotionPageProperties {
  Title: {
    title: { text: { content: string } }[];
  };
  URL: {
    url: string;
  };
  Folder: {
    rich_text: { text: { content: string } }[];
  };
  Tags: {
    multi_select: { name: string }[];
  };
  'Date Added': {
    date: { start: string };
  };
  'Sync ID': {
    rich_text: { text: { content: string } }[];
  };
}

// Extend Express Request interface globally
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
      };
    }
  }
}
