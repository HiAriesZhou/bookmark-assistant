import { PrismaClient } from '@prisma/client';
import { UserData } from '../types';
import { config } from '../config';

// Create singleton PrismaClient instance
// This prevents multiple instances from creating separate connection pools
let prismaInstance: PrismaClient | null = null;

function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      'Missing required environment variable: DATABASE_URL. Set it in the server runtime environment before initializing Prisma.'
    );
  }

  return config.databaseUrl;
}

function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: requireDatabaseUrl(),
        },
      },
      // Connection pool configuration via DATABASE_URL parameters.
      // If not in URL, Prisma defaults are used (connection_limit: number of CPUs * 2 + 1).
      // For production, ensure DATABASE_URL includes: ?connection_limit=20&pool_timeout=10
    });

    // Log connection pool info on startup
    const dbUrl = config.databaseUrl;
    const connectionLimit = dbUrl.match(/connection_limit=(\d+)/)?.[1] || 'default';
    console.log(`[Prisma] Connection pool initialized (limit: ${connectionLimit})`);

    // Handle graceful shutdown
    process.on('beforeExit', async () => {
      await prismaInstance?.$disconnect();
    });
  }

  return prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const userCompatSelect = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  googleSub: true,
  notionUserId: true,
  notionAccessToken: true,
  notionRefreshToken: true,
  notionWorkspaceId: true,
  notionWorkspaceName: true,
  botId: true,
  duplicatedTemplateId: true,
  notionDatabaseId: true,
  notionDataSourceId: true,
  notionDatabaseName: true,
  templateDatabaseId: true,
  databases: true,
  lastActivity: true,
  plan: true,
  subscriptionSource: true,
  expiresAt: true,
  purchaseType: true,
  paddleCustomerId: true,
  paddleSubscriptionId: true,
} as const;

export class UserPrismaRepo {
  /**
   * Resolves either the internal CUID used by new sessions or the legacy Notion user ID.
   * Relational product data must always use the internal ID.
   */
  async resolveInternalUserId(userId: string): Promise<string | undefined> {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ id: userId }, { notionUserId: userId }],
      },
      select: { id: true },
    });

    return user?.id;
  }

  async upsert(user: UserData): Promise<void> {
    const data = {
      notionUserId: user.userId,
      notionAccessToken: user.notionAccessToken,
      notionRefreshToken: user.notionRefreshToken || null,
      notionWorkspaceId: user.notionWorkspaceId || null,
      ...(user.notionWorkspaceName ? { notionWorkspaceName: user.notionWorkspaceName } : {}),
      botId: user.botId || null,
      duplicatedTemplateId: user.duplicatedTemplateId || null,
      notionDatabaseId: user.notionDatabaseId || null,
      notionDataSourceId: user.notionDataSourceId || null,
      ...(user.notionDatabaseName ? { notionDatabaseName: user.notionDatabaseName } : {}),
      templateDatabaseId: user.templateDatabaseId || null,
      databases: user.databases || [],
      lastActivity: user.lastActivity,
    };

    await prisma.user.upsert({
      where: { notionUserId: user.userId },
      create: {
        ...data,
        email: user.email || `missing_${user.userId}@example.com`, // Fallback if email missing
      },
      update: data,
    });
  }

  async find(userId: string): Promise<UserData | undefined> {
    // Try finding by CUID first (new system)
    let u = await prisma.user.findUnique({ where: { id: userId }, select: userCompatSelect });

    // Fallback: try finding by notionUserId (legacy system/JWTs)
    if (!u) {
      u = await prisma.user.findUnique({
        where: { notionUserId: userId },
        select: userCompatSelect,
      });
    }

    if (!u) return undefined;
    return {
      id: u.id,
      userId: u.notionUserId || '',
      email: u.email || undefined,
      emailVerifiedAt: u.emailVerifiedAt,
      googleSub: u.googleSub,
      notionAccessToken: u.notionAccessToken || '',
      notionRefreshToken: u.notionRefreshToken || undefined,
      notionWorkspaceId: u.notionWorkspaceId || undefined,
      notionWorkspaceName: u.notionWorkspaceName || undefined,
      botId: u.botId || undefined,
      duplicatedTemplateId: u.duplicatedTemplateId || undefined,
      notionDatabaseId: u.notionDatabaseId || undefined,
      notionDataSourceId: u.notionDataSourceId || undefined,
      notionDatabaseName: u.notionDatabaseName || undefined,
      templateDatabaseId: u.templateDatabaseId || undefined,
      databases: (u.databases as any) || [],
      lastActivity: u.lastActivity,
      plan: u.plan,
      subscriptionSource: u.subscriptionSource,
      expiresAt: u.expiresAt,
      purchaseType: u.purchaseType || undefined,
      paddleCustomerId: u.paddleCustomerId || undefined,
      paddleSubscriptionId: u.paddleSubscriptionId || undefined,
    };
  }

  async updateTokens(userId: string, access: string, refresh?: string) {
    // Try update by CUID or Notion ID
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          notionAccessToken: access,
          notionRefreshToken: refresh || null,
          lastActivity: new Date(),
        },
      });
    } catch {
      await prisma.user.update({
        where: { notionUserId: userId },
        data: {
          notionAccessToken: access,
          notionRefreshToken: refresh || null,
          lastActivity: new Date(),
        },
      });
    }
  }

  async setResolvedDatabase(
    userId: string,
    duplicated_template_id: string,
    databaseId: string,
    dataSourceId: string | null,
    databaseName?: string
  ) {
    const data = {
      templateDatabaseId: duplicated_template_id,
      notionDatabaseId: databaseId,
      notionDataSourceId: dataSourceId,
      ...(databaseName ? { notionDatabaseName: databaseName } : {}),
      lastActivity: new Date(),
    };

    try {
      await prisma.user.update({
        where: { id: userId },
        data,
      });
    } catch {
      await prisma.user.update({
        where: { notionUserId: userId },
        data,
      });
    }
  }

  async update(
    userId: string,
    updates: Partial<{
      notionDatabaseId: string;
      notionDataSourceId: string;
      notionDatabaseName: string;
      templateDatabaseId: string;
    }>
  ) {
    const data = {
      ...updates,
      lastActivity: new Date(),
    };

    try {
      await prisma.user.update({
        where: { id: userId },
        data,
      });
    } catch {
      await prisma.user.update({
        where: { notionUserId: userId },
        data,
      });
    }
  }
}

export const userPrisma = new UserPrismaRepo();
