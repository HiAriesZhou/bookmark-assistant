/**
 * Tests for DescriptionCacheService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./userPrisma', () => ({
  prisma: {
    descriptionCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

import { DescriptionCacheService } from './description-cache';

describe('DescriptionCacheService', () => {
  let cacheService: DescriptionCacheService;
  let mockPrisma: any;

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      descriptionCache: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
      },
    };
    cacheService = new DescriptionCacheService(mockPrisma);
  });

  describe('get', () => {
    it('should return cached description if not expired', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockPrisma.descriptionCache.findUnique.mockResolvedValue({
        url: 'https://example.com',
        description: 'Test description',
        source: 'meta_description',
        createdAt: new Date(),
        expiresAt: futureDate,
        hits: 5,
      });

      // Mock update for hit increment
      mockPrisma.descriptionCache.update.mockResolvedValue({});

      const result = await cacheService.get('https://example.com');

      expect(result).not.toBeNull();
      expect(result?.description).toBe('Test description');
      expect(result?.source).toBe('meta_description');
      expect(result?.fromCache).toBe(true);
      expect(result?.hits).toBe(5);
      expect(mockPrisma.descriptionCache.findUnique).toHaveBeenCalledWith({
        where: { url: 'https://example.com' },
      });
    });

    it('should return null if cache expired', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockPrisma.descriptionCache.findUnique.mockResolvedValue({
        url: 'https://example.com',
        description: 'Test description',
        source: 'meta_description',
        createdAt: new Date(),
        expiresAt: pastDate,
        hits: 5,
      });

      const result = await cacheService.get('https://example.com');

      expect(result).toBeNull();
    });

    it('should return null if not in cache', async () => {
      mockPrisma.descriptionCache.findUnique.mockResolvedValue(null);

      const result = await cacheService.get('https://example.com');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      mockPrisma.descriptionCache.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await cacheService.get('https://example.com');

      expect(result).toBeNull();
    });

    it('should increment hit counter on cache hit', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockPrisma.descriptionCache.findUnique.mockResolvedValue({
        url: 'https://example.com',
        description: 'Test description',
        source: 'meta_description',
        createdAt: new Date(),
        expiresAt: futureDate,
        hits: 5,
      });

      mockPrisma.descriptionCache.update.mockResolvedValue({});

      await cacheService.get('https://example.com');

      // Give async increment time to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPrisma.descriptionCache.update).toHaveBeenCalledWith({
        where: { url: 'https://example.com' },
        data: {
          hits: { increment: 1 },
          lastHitAt: expect.any(Date),
        },
      });
    });
  });

  describe('set', () => {
    it('should cache description with TTL', async () => {
      mockPrisma.descriptionCache.upsert.mockResolvedValue({});

      await cacheService.set('https://example.com', 'Test description', 'meta_description');

      expect(mockPrisma.descriptionCache.upsert).toHaveBeenCalledWith({
        where: { url: 'https://example.com' },
        update: {
          description: 'Test description',
          source: 'meta_description',
          expiresAt: expect.any(Date),
        },
        create: {
          url: 'https://example.com',
          description: 'Test description',
          source: 'meta_description',
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should set expiration 30 days in future', async () => {
      mockPrisma.descriptionCache.upsert.mockResolvedValue({});

      const beforeCall = new Date();
      await cacheService.set('https://example.com', 'Test description', 'meta_description');

      const call = mockPrisma.descriptionCache.upsert.mock.calls[0][0];
      const expiresAt = call.create.expiresAt;

      // Should be approximately 30 days in the future
      const expectedExpiration = new Date(beforeCall.getTime() + 30 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(expiresAt.getTime() - expectedExpiration.getTime());

      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });

    it('should update existing cache entry', async () => {
      mockPrisma.descriptionCache.upsert.mockResolvedValue({});

      await cacheService.set('https://example.com', 'Updated description', 'og_description');

      const call = mockPrisma.descriptionCache.upsert.mock.calls[0][0];
      expect(call.update.description).toBe('Updated description');
      expect(call.update.source).toBe('og_description');
    });

    it('should handle errors', async () => {
      mockPrisma.descriptionCache.upsert.mockRejectedValue(new Error('Database error'));

      await expect(
        cacheService.set('https://example.com', 'Test description', 'meta_description')
      ).rejects.toThrow('Database error');
    });
  });

  describe('cleanExpired', () => {
    it('should delete expired entries', async () => {
      mockPrisma.descriptionCache.deleteMany.mockResolvedValue({ count: 10 });

      const deletedCount = await cacheService.cleanExpired();

      expect(deletedCount).toBe(10);
      expect(mockPrisma.descriptionCache.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it('should return 0 on error', async () => {
      mockPrisma.descriptionCache.deleteMany.mockRejectedValue(new Error('Database error'));

      const deletedCount = await cacheService.cleanExpired();

      expect(deletedCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const mockEntries = [
        { hits: 10, createdAt: new Date('2025-01-01') },
        { hits: 20, createdAt: new Date('2025-01-15') },
        { hits: 5, createdAt: new Date('2025-01-10') },
      ];
      mockPrisma.descriptionCache.findMany.mockResolvedValue(mockEntries);

      const stats = await cacheService.getStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.avgHits).toBeCloseTo(11.67, 2); // (10 + 20 + 5) / 3
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.oldestEntry).toEqual(new Date('2025-01-01'));
      expect(stats.newestEntry).toEqual(new Date('2025-01-15'));
    });

    it('should handle empty cache', async () => {
      mockPrisma.descriptionCache.findMany.mockResolvedValue([]);

      const stats = await cacheService.getStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.avgHits).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      mockPrisma.descriptionCache.findMany.mockRejectedValue(new Error('Database error'));

      const stats = await cacheService.getStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should calculate hit rate correctly', async () => {
      // 3 entries with 30 total hits = 30/(3+30) = 0.909
      const mockEntries = [
        { hits: 10, createdAt: new Date('2025-01-01') },
        { hits: 15, createdAt: new Date('2025-01-02') },
        { hits: 5, createdAt: new Date('2025-01-03') },
      ];
      mockPrisma.descriptionCache.findMany.mockResolvedValue(mockEntries);

      const stats = await cacheService.getStats();

      expect(stats.hitRate).toBeCloseTo(0.909, 2);
    });
  });

  describe('invalidate', () => {
    it('should delete cache entry', async () => {
      mockPrisma.descriptionCache.delete.mockResolvedValue({});

      const result = await cacheService.invalidate('https://example.com');

      expect(result).toBe(true);
      expect(mockPrisma.descriptionCache.delete).toHaveBeenCalledWith({
        where: { url: 'https://example.com' },
      });
    });

    it('should return false on error', async () => {
      mockPrisma.descriptionCache.delete.mockRejectedValue(new Error('Not found'));

      const result = await cacheService.invalidate('https://example.com');

      expect(result).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('should delete all cache entries', async () => {
      mockPrisma.descriptionCache.deleteMany.mockResolvedValue({ count: 100 });

      const deletedCount = await cacheService.clearAll();

      expect(deletedCount).toBe(100);
      expect(mockPrisma.descriptionCache.deleteMany).toHaveBeenCalledWith({});
    });

    it('should return 0 on error', async () => {
      mockPrisma.descriptionCache.deleteMany.mockRejectedValue(new Error('Database error'));

      const deletedCount = await cacheService.clearAll();

      expect(deletedCount).toBe(0);
    });
  });
});
