/**
 * Description caching service
 * Caches extracted descriptions to reduce redundant URL fetches
 */

import { PrismaClient } from '@prisma/client';
import { isRetryablePersistenceError } from '../core';
import { prisma } from './userPrisma';

export interface CachedDescription {
  url: string;
  description: string;
  source: 'meta_description' | 'og_description' | 'title' | 'content' | 'empty';
  createdAt: Date;
  hits: number;
  fromCache: boolean;
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  avgHits: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

export class DescriptionCacheService {
  private prisma: PrismaClient;
  private ttlDays = 30;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get cached description for URL
   * Returns null if not in cache or expired
   */
  async get(url: string): Promise<CachedDescription | null> {
    try {
      const now = new Date();

      const cached = await this.prisma.descriptionCache.findUnique({
        where: { url },
      });

      // Cache miss or expired
      if (!cached || cached.expiresAt < now) {
        if (cached && cached.expiresAt < now) {
          console.log('[DescriptionCache] Expired entry');
        }
        return null;
      }

      // Update hit counter (async, don't wait)
      // Use setTimeout to defer execution and avoid immediate connection usage
      setTimeout(() => {
        this.incrementHit(url).catch((err) => {
          // Only log if it's not a connection pool error (expected under load)
          if (!err?.message?.includes('MaxClientsInSessionMode')) {
            console.warn('[DescriptionCache] Failed to increment hit:', err);
          }
        });
      }, 0);

      return {
        url: cached.url,
        description: cached.description,
        source: cached.source as any,
        createdAt: cached.createdAt,
        hits: cached.hits,
        fromCache: true,
      };
    } catch (error) {
      console.error('[DescriptionCache] Error getting cache:', error);
      return null;
    }
  }

  /**
   * Store description in cache
   * Includes retry logic for connection pool exhaustion errors
   */
  async set(url: string, description: string, source: string): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlDays * 24 * 60 * 60 * 1000);

        await this.prisma.descriptionCache.upsert({
          where: { url },
          update: {
            description,
            source,
            expiresAt,
          },
          create: {
            url,
            description,
            source,
            expiresAt,
          },
        });

        console.log('[DescriptionCache] Cached description');
        return; // Success, exit retry loop
      } catch (error: any) {
        attempt++;

        if (isRetryablePersistenceError(error) && attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delayMs = 100 * Math.pow(2, attempt - 1);
          console.warn(
            `[DescriptionCache] Connection pool exhausted, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // If not a pool error or max retries reached, throw
        console.error('[DescriptionCache] Error setting cache:', error);
        throw error;
      }
    }
  }

  /**
   * Increment hit counter for URL
   */
  private async incrementHit(url: string): Promise<void> {
    try {
      await this.prisma.descriptionCache.update({
        where: { url },
        data: {
          hits: { increment: 1 },
          lastHitAt: new Date(),
        },
      });
    } catch (error) {
      console.warn('[DescriptionCache] Error incrementing hit:', error);
    }
  }

  /**
   * Clean expired cache entries
   */
  async cleanExpired(): Promise<number> {
    try {
      const result = await this.prisma.descriptionCache.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      console.log(`[DescriptionCache] Cleaned ${result.count} expired entries`);
      return result.count;
    } catch (error) {
      console.error('[DescriptionCache] Error cleaning expired:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const entries = await this.prisma.descriptionCache.findMany({
        where: {
          expiresAt: { gte: new Date() },
        },
        select: {
          hits: true,
          createdAt: true,
        },
      });

      const totalHits = entries.reduce((sum: number, e: any) => sum + e.hits, 0);
      const totalRequests = entries.length + totalHits;

      return {
        totalEntries: entries.length,
        hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
        avgHits: entries.length > 0 ? totalHits / entries.length : 0,
        oldestEntry:
          entries.length > 0
            ? entries.reduce(
                (min: Date, e: any) => (e.createdAt < min ? e.createdAt : min),
                entries[0].createdAt
              )
            : null,
        newestEntry:
          entries.length > 0
            ? entries.reduce(
                (max: Date, e: any) => (e.createdAt > max ? e.createdAt : max),
                entries[0].createdAt
              )
            : null,
      };
    } catch (error) {
      console.error('[DescriptionCache] Error getting stats:', error);
      return {
        totalEntries: 0,
        hitRate: 0,
        avgHits: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }
  }

  /**
   * Invalidate cache entry by URL
   */
  async invalidate(url: string): Promise<boolean> {
    try {
      await this.prisma.descriptionCache.delete({
        where: { url },
      });
      console.log('[DescriptionCache] Invalidated cache entry');
      return true;
    } catch (error) {
      console.warn('[DescriptionCache] Error invalidating cache:', error);
      return false;
    }
  }

  /**
   * Clear all cache entries (use with caution)
   */
  async clearAll(): Promise<number> {
    try {
      const result = await this.prisma.descriptionCache.deleteMany({});
      console.log(`[DescriptionCache] Cleared all ${result.count} entries`);
      return result.count;
    } catch (error) {
      console.error('[DescriptionCache] Error clearing all:', error);
      return 0;
    }
  }
}

// Singleton instance
export const descriptionCache = new DescriptionCacheService(prisma);
