/**
 * Cleanup job for expired description cache entries
 * Runs periodically to remove expired entries and maintain cache health
 */

import { descriptionCache } from '../services/description-cache';

/**
 * Clean up expired description cache entries
 */
export async function cleanupExpiredDescriptions(): Promise<void> {
  console.log('[CacheCleanup] Starting cleanup of expired descriptions...');

  try {
    const startTime = Date.now();

    // Delete expired entries
    const deletedCount = await descriptionCache.cleanExpired();

    // Get cache stats
    const stats = await descriptionCache.getStats();

    const duration = Date.now() - startTime;

    console.log('[CacheCleanup] Cleanup completed:', {
      deletedCount,
      duration: `${duration}ms`,
      remainingEntries: stats.totalEntries,
      hitRate: `${(stats.hitRate * 100).toFixed(2)}%`,
      avgHits: stats.avgHits.toFixed(2),
    });
  } catch (error) {
    console.error('[CacheCleanup] Failed to cleanup cache:', error);
  }
}

/**
 * Schedule periodic cleanup job
 * Runs once per day at 3 AM
 */
export function scheduleCleanupJob(): void {
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  // Run initial cleanup after 1 minute
  setTimeout(() => {
    cleanupExpiredDescriptions();

    // Schedule recurring cleanup
    setInterval(cleanupExpiredDescriptions, CLEANUP_INTERVAL);
  }, 60 * 1000);

  console.log('[CacheCleanup] Scheduled daily cleanup job');
}

export const DESCRIPTION_CACHE_OPPORTUNISTIC_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function createOpportunisticDescriptionCacheCleanup(
  cleanup: () => Promise<void> = cleanupExpiredDescriptions,
  intervalMs = DESCRIPTION_CACHE_OPPORTUNISTIC_CLEANUP_INTERVAL_MS
): (now?: number) => Promise<void> {
  let lastStartedAt: number | undefined;
  let inFlight: Promise<void> | undefined;

  return async (now = Date.now()): Promise<void> => {
    if (inFlight) return inFlight;
    if (lastStartedAt !== undefined && now - lastStartedAt < intervalMs) return;

    lastStartedAt = now;
    inFlight = cleanup()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

/** Vercel has no resident process, so public requests provide cleanup opportunities. */
export const cleanupExpiredDescriptionsOpportunistically =
  createOpportunisticDescriptionCacheCleanup();
