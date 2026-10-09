// 🛠️ Utility Functions for Server Operations

import { BookmarkItem } from '../types';
import { isValidUrl as isValidCoreUrl, validateBookmarkInput } from '../core';
import { randomUUID } from 'crypto';
import { hasProAccess } from './entitlements';
import { logger } from './logger';

export {
  hasProAccess,
  isDeveloperEmail,
  resolveProEntitlement,
  type Plan,
  type ProEntitlement,
  type SubscriptionSource,
} from './entitlements';

// Re-export logger
export { logger } from './logger';

/**
 * Debug logging utility - delegates to logger
 * @deprecated Use logger.debug() instead
 */
export const debugLog = (message: string, ...args: any[]): void => {
  // Delegate to logger - kept for backward compatibility
  logger.debug(message, ...args);
};

/**
 * Audit logging utility for security and debugging
 * Writes to logger for persistence
 */
export const auditLog = (action: string, userId: string, details: any = {}): void => {
  // Log audit events using the logger for persistence
  logger.info(`[AUDIT] ${action}`, { userId, ...details });
};

/**
 * Resolve effective Pro entitlement.
 *
 * Official cloud deployments use the user's paid plan from the database.
 * Self-hosted deployments default to Pro-level local limits because there is
 * no official billing service in that environment.
 */
export const hasProEntitlements = hasProAccess;

/**
 * Retry wrapper for HTTP requests with exponential backoff
 */
export const retryRequest = async <T>(
  requestFn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> => {
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      return await requestFn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }

  throw new Error('Max retries exceeded');
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
 * Generate a unique sync ID for bookmarks
 */
export const generateSyncId = (url: string, timestamp?: number): string => {
  const time = timestamp || Date.now();
  return `bookmark_${url}_${time}`;
};

/**
 * Check if a session has expired
 */
export const isSessionExpired = (lastActivity: Date, expiryHours = 24): boolean => {
  const now = new Date();
  const expiredThreshold = expiryHours * 60 * 60 * 1000; // Convert to milliseconds
  return now.getTime() - lastActivity.getTime() > expiredThreshold;
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

/**
 * Validate URL format
 */
export const isValidUrl = (url: string): boolean => {
  return isValidCoreUrl(url);
};

/**
 * Generate a secure random string
 */
export const generateSecureId = (length = 16): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
