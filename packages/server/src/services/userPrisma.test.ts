/**
 * Unit tests for UserPrismaRepo service
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserPrismaRepo } from './userPrisma';

// Mock Prisma Client
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
  },
  $disconnect: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return mockPrisma;
  }),
}));

vi.mock('../config', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    notion: {
      databaseId: 'test-db-id',
    },
  },
}));

describe('UserPrismaRepo', () => {
  let userRepo: UserPrismaRepo;

  beforeEach(() => {
    vi.clearAllMocks();
    userRepo = new UserPrismaRepo();
  });

  describe('upsert', () => {
    it('should upsert user with all fields', async () => {
      const userData = {
        userId: 'user-123',
        email: 'test@example.com',
        notionAccessToken: 'token-123',
        notionRefreshToken: 'refresh-123',
        notionWorkspaceId: 'workspace-123',
        botId: 'bot-123',
        duplicatedTemplateId: 'template-123',
        notionDatabaseId: 'db-123',
        notionDataSourceId: 'ds-123',
        templateDatabaseId: 'tpl-123',
        databases: ['db1', 'db2'],
        lastActivity: new Date(),
        plan: 'pro',
        subscriptionSource: 'paddle',
        expiresAt: null,
        purchaseType: 'monthly',
        paddleCustomerId: 'ctm_123',
        paddleSubscriptionId: 'sub_123',
      };

      await userRepo.upsert(userData);

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
        where: { notionUserId: 'user-123' },
        create: {
          notionUserId: 'user-123',
          notionAccessToken: 'token-123',
          notionRefreshToken: 'refresh-123',
          notionWorkspaceId: 'workspace-123',
          botId: 'bot-123',
          duplicatedTemplateId: 'template-123',
          notionDatabaseId: 'db-123',
          notionDataSourceId: 'ds-123',
          templateDatabaseId: 'tpl-123',
          databases: ['db1', 'db2'],
          lastActivity: expect.any(Date),
          email: 'test@example.com',
        },
        update: {
          notionUserId: 'user-123',
          notionAccessToken: 'token-123',
          notionRefreshToken: 'refresh-123',
          notionWorkspaceId: 'workspace-123',
          botId: 'bot-123',
          duplicatedTemplateId: 'template-123',
          notionDatabaseId: 'db-123',
          notionDataSourceId: 'ds-123',
          templateDatabaseId: 'tpl-123',
          databases: ['db1', 'db2'],
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should use fallback email if not provided', async () => {
      const userData = {
        userId: 'user-123',
        notionAccessToken: 'token-123',
        lastActivity: new Date(),
      };

      await userRepo.upsert(userData);

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: 'missing_user-123@example.com',
          }),
        })
      );
    });

    it('should handle optional fields as null', async () => {
      const userData = {
        userId: 'user-123',
        notionAccessToken: 'token-123',
        lastActivity: new Date(),
      };

      await userRepo.upsert(userData);

      expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            notionRefreshToken: null,
            notionWorkspaceId: null,
            botId: null,
            duplicatedTemplateId: null,
            notionDatabaseId: null,
            notionDataSourceId: null,
            templateDatabaseId: null,
            databases: [],
          }),
        })
      );
    });
  });

  describe('find', () => {
    it('should find user by CUID', async () => {
      const mockUser = {
        id: 'user-123',
        notionUserId: 'notion-456',
        email: 'test@example.com',
        notionAccessToken: 'token-123',
        notionRefreshToken: 'refresh-123',
        notionWorkspaceId: 'workspace-123',
        botId: 'bot-123',
        duplicatedTemplateId: 'template-123',
        notionDatabaseId: 'db-123',
        notionDataSourceId: 'ds-123',
        templateDatabaseId: 'tpl-123',
        databases: ['db1', 'db2'],
        lastActivity: new Date(),
        plan: 'pro',
        subscriptionSource: 'paddle',
        expiresAt: null,
        purchaseType: 'monthly',
        paddleCustomerId: 'ctm_123',
        paddleSubscriptionId: 'sub_123',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await userRepo.find('user-123');

      expect(result).toEqual({
        id: 'user-123',
        userId: 'notion-456',
        email: 'test@example.com',
        notionAccessToken: 'token-123',
        notionRefreshToken: 'refresh-123',
        notionWorkspaceId: 'workspace-123',
        botId: 'bot-123',
        duplicatedTemplateId: 'template-123',
        notionDatabaseId: 'db-123',
        notionDataSourceId: 'ds-123',
        templateDatabaseId: 'tpl-123',
        databases: ['db1', 'db2'],
        lastActivity: mockUser.lastActivity,
        plan: 'pro',
        subscriptionSource: 'paddle',
        expiresAt: null,
        purchaseType: 'monthly',
        paddleCustomerId: 'ctm_123',
        paddleSubscriptionId: 'sub_123',
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: expect.objectContaining({
          id: true,
          email: true,
          plan: true,
          purchaseType: true,
        }),
      });
    });

    it('should fallback to notionUserId if CUID not found', async () => {
      const mockUser = {
        id: 'user-456',
        notionUserId: 'notion-123',
        email: 'test@example.com',
        notionAccessToken: 'token-123',
        lastActivity: new Date(),
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // First call (by CUID) fails
        .mockResolvedValueOnce(mockUser as any); // Second call (by notionUserId) succeeds

      const result = await userRepo.find('notion-123');

      expect(result).toBeDefined();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return undefined if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await userRepo.find('non-existent');

      expect(result).toBeUndefined();
    });

    it('should handle missing optional fields', async () => {
      const mockUser = {
        id: 'user-123',
        notionUserId: 'notion-123',
        email: 'test@example.com',
        notionAccessToken: 'token-123',
        lastActivity: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await userRepo.find('user-123');

      expect(result?.notionRefreshToken).toBeUndefined();
      expect(result?.databases).toEqual([]);
    });
  });

  describe('updateTokens', () => {
    it('should update tokens by CUID', async () => {
      mockPrisma.user.update.mockResolvedValue({} as any);

      await userRepo.updateTokens('user-123', 'new-token', 'new-refresh');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          notionAccessToken: 'new-token',
          notionRefreshToken: 'new-refresh',
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should fallback to notionUserId if CUID update fails', async () => {
      mockPrisma.user.update
        .mockRejectedValueOnce(new Error('Not found')) // First call fails
        .mockResolvedValue({} as any); // Second call succeeds

      await userRepo.updateTokens('user-123', 'new-token');

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(2, {
        where: { notionUserId: 'user-123' },
        data: {
          notionAccessToken: 'new-token',
          notionRefreshToken: null,
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should handle missing refresh token', async () => {
      mockPrisma.user.update.mockResolvedValue({} as any);

      await userRepo.updateTokens('user-123', 'new-token');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          notionAccessToken: 'new-token',
          notionRefreshToken: null,
          lastActivity: expect.any(Date),
        },
      });
    });
  });

  describe('setResolvedDatabase', () => {
    it('should set resolved database by CUID', async () => {
      mockPrisma.user.update.mockResolvedValue({} as any);

      await userRepo.setResolvedDatabase('user-123', 'template-123', 'db-123', 'ds-123');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          templateDatabaseId: 'template-123',
          notionDatabaseId: 'db-123',
          notionDataSourceId: 'ds-123',
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should fallback to notionUserId if CUID update fails', async () => {
      mockPrisma.user.update
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValue({} as any);

      await userRepo.setResolvedDatabase('user-123', 'template-123', 'db-123', null);

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    it('should update partial fields by CUID', async () => {
      mockPrisma.user.update.mockResolvedValue({} as any);

      await userRepo.update('user-123', {
        notionDatabaseId: 'db-123',
        notionDataSourceId: 'ds-123',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          notionDatabaseId: 'db-123',
          notionDataSourceId: 'ds-123',
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should fallback to notionUserId if CUID update fails', async () => {
      mockPrisma.user.update
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValue({} as any);

      await userRepo.update('user-123', {
        notionDatabaseId: 'db-123',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenNthCalledWith(2, {
        where: { notionUserId: 'user-123' },
        data: {
          notionDatabaseId: 'db-123',
          lastActivity: expect.any(Date),
        },
      });
    });

    it('should handle empty updates', async () => {
      mockPrisma.user.update.mockResolvedValue({} as any);

      await userRepo.update('user-123', {});

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          lastActivity: expect.any(Date),
        },
      });
    });
  });

  describe('error handling', () => {
    it('should handle database errors in find', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database connection failed'));

      await expect(userRepo.find('user-123')).rejects.toThrow('Database connection failed');
    });

    it('should handle database errors in upsert', async () => {
      mockPrisma.user.upsert.mockRejectedValue(new Error('Upsert failed'));

      const userData = {
        userId: 'user-123',
        notionAccessToken: 'token',
        lastActivity: new Date(),
      };

      await expect(userRepo.upsert(userData)).rejects.toThrow('Upsert failed');
    });
  });
});
