// 🛠️ Utility Functions for Server Operations

import { BookmarkItem } from '../types';
import { validateBookmarkInput } from '../core';
import { randomUUID } from 'crypto';
import { logger } from './logger';

export {
  resolveProEntitlement,
  type Plan,
  type ProEntitlement,
  type SubscriptionSource,
} from './entitlements';

// Re-export logger
export { logger } from './logger';

/**
 * Audit logging utility for security and debugging
 * Writes to logger for persistence
 */
export const auditLog = (action: string, userId: string, details: any = {}): void => {
  // Log audit events using the logger for persistence
  logger.info(`[AUDIT] ${action}`, { userId, ...details });
};

/**
 * Sleep utility for rate limiting
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Validate and sanitize bookmark data
 */
export const validateBookmark = (bookmark: any, _index: number): BookmarkItem => {
  return validateBookmarkInput(bookmark, {
    createSyncId: () => randomUUID(),
  }) as BookmarkItem;
};

/**
 * Sanitize error messages for client responses
 */
export const sanitizeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Create batch arrays from a larger array
 */
export const createBatches = <T>(array: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
};
