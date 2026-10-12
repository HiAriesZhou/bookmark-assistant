// 👥 Service account lifecycle. Notion OAuth identifies the account; plans stay with it.

import { Prisma } from '@prisma/client';
import { prisma } from './userPrisma';

const accountSelect = { id: true, email: true, plan: true } as const;

/** Case-insensitive so mixed-case Notion emails adopt existing paid or granted accounts. */
export function findAccountByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: accountSelect,
  });
}

export const NOTION_CONNECTION_RESET = {
  notionUserId: null,
  notionAccessToken: null,
  notionRefreshToken: null,
  notionWorkspaceId: null,
  notionWorkspaceName: null,
  notionDatabaseId: null,
  notionDataSourceId: null,
  notionDatabaseName: null,
  templateDatabaseId: null,
  duplicatedTemplateId: null,
  botId: null,
  databases: Prisma.DbNull,
} satisfies Prisma.UserUpdateInput;

/**
 * Removes the Notion destination but keeps the account, its plan and AI settings.
 * AI work items point at Notion pages and are removed with the connection.
 */
export async function disconnectNotion(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.aiGenerationTask.deleteMany({ where: { userId } }),
    prisma.aiGenerationBatch.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: NOTION_CONNECTION_RESET }),
  ]);
}

export async function deleteAccount(userId: string): Promise<void> {
  await prisma.user.deleteMany({ where: { id: userId } });
}
