// 👥 Account identity: one Bookmark Assistant account, optional linked sign-ins.

import { Prisma } from '@prisma/client';
import type { GoogleIdentity } from './google-auth';
import { prisma } from './userPrisma';

export class AccountConflictError extends Error {
  constructor(
    message: string,
    readonly code: 'GOOGLE_ACCOUNT_CONFLICT' | 'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
  ) {
    super(message);
  }
}

const accountSelect = { id: true, email: true, googleSub: true, plan: true } as const;

export function findAccountByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: accountSelect,
  });
}

/**
 * Resolves the account for a verified Google identity. Existing accounts created
 * through Notion, Paddle or an operator grant are adopted by verified email so
 * plan and purchase history stay with the person.
 */
export async function resolveGoogleAccount(identity: GoogleIdentity) {
  const now = new Date();
  const linked = await prisma.user.findUnique({
    where: { googleSub: identity.sub },
    select: accountSelect,
  });
  if (linked) {
    return prisma.user.update({
      where: { id: linked.id },
      data: { lastActivity: now },
      select: accountSelect,
    });
  }

  const byEmail = await findAccountByEmail(identity.email);
  if (byEmail) {
    if (byEmail.googleSub && byEmail.googleSub !== identity.sub) {
      throw new AccountConflictError(
        'This email belongs to an account linked to a different Google identity',
        'GOOGLE_ACCOUNT_CONFLICT'
      );
    }
    return prisma.user.update({
      where: { id: byEmail.id },
      data: { googleSub: identity.sub, lastActivity: now },
      select: accountSelect,
    });
  }

  return prisma.user.create({
    data: { email: identity.email, googleSub: identity.sub, plan: 'free' },
    select: accountSelect,
  });
}

/** Adds Google sign-in to the signed-in account instead of switching accounts. */
export async function linkGoogleIdentity(userId: string, identity: GoogleIdentity) {
  const linked = await prisma.user.findUnique({
    where: { googleSub: identity.sub },
    select: accountSelect,
  });
  if (linked && linked.id !== userId) {
    throw new AccountConflictError(
      'This Google account already signs in to another Bookmark Assistant account',
      'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
    );
  }
  return prisma.user.update({
    where: { id: userId },
    data: { googleSub: identity.sub, lastActivity: new Date() },
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
