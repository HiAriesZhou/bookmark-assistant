// Account identity. Verified email creates or adopts the account; Notion stays a destination.

import { Prisma } from '@prisma/client';
import type { GoogleIdentity } from './google-auth';
import { prisma } from './userPrisma';

export class AccountConflictError extends Error {
  constructor(
    message: string,
    readonly code: 'GOOGLE_ACCOUNT_CONFLICT' | 'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
  ) {
    super(message);
    this.name = 'AccountConflictError';
  }
}

const accountSelect = {
  id: true,
  email: true,
  plan: true,
  googleSub: true,
  notionAccessToken: true,
  emailVerifiedAt: true,
} as const;

export type ResolvedAccount = {
  id: string;
  email: string;
  plan: string;
  googleSub: string | null;
  notionAccessToken: string | null;
  emailVerifiedAt: Date | null;
  created: boolean;
};

/** Case-insensitive so mixed-case Notion emails adopt existing paid or granted accounts. */
export function findAccountByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: accountSelect,
  });
}

/**
 * One account per verified email. An existing Notion, Paddle or granted account is
 * adopted so its plan and stored provider key stay with the person.
 */
export async function findOrCreateByVerifiedEmail(email: string): Promise<ResolvedAccount> {
  const trimmed = email.trim();
  const normalized = trimmed.toLowerCase();
  const now = new Date();
  const existing = await findAccountByEmail(trimmed);
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { emailVerifiedAt: now, lastActivity: now },
      select: accountSelect,
    });
    return { ...updated, created: false };
  }

  try {
    const created = await prisma.user.create({
      data: { email: normalized, emailVerifiedAt: now, plan: 'free', lastActivity: now },
      select: accountSelect,
    });
    return { ...created, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await findAccountByEmail(normalized);
      if (raced) {
        const updated = await prisma.user.update({
          where: { id: raced.id },
          data: { emailVerifiedAt: now, lastActivity: now },
          select: accountSelect,
        });
        return { ...updated, created: false };
      }
    }
    throw error;
  }
}

async function attachGoogleSubject(
  userId: string,
  sub: string,
  currentSub: string | null
): Promise<Omit<ResolvedAccount, 'created'>> {
  const linked = await prisma.user.findUnique({
    where: { googleSub: sub },
    select: accountSelect,
  });
  if (linked && linked.id !== userId) {
    throw new AccountConflictError(
      'This Google account already signs in to another Bookmark Assistant account',
      'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
    );
  }
  if (currentSub && currentSub !== sub) {
    throw new AccountConflictError(
      'This email belongs to an account linked to a different Google identity',
      'GOOGLE_ACCOUNT_CONFLICT'
    );
  }
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        ...(currentSub === sub ? {} : { googleSub: sub }),
        lastActivity: new Date(),
      },
      select: accountSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AccountConflictError(
        'This Google account already signs in to another Bookmark Assistant account',
        'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
      );
    }
    throw error;
  }
}

/** Signs in by verified Google email, refusing a subject that belongs to someone else. */
export async function resolveGoogleAccount(identity: GoogleIdentity): Promise<ResolvedAccount> {
  const linked = await prisma.user.findUnique({
    where: { googleSub: identity.sub },
    select: accountSelect,
  });
  const byEmail = await findAccountByEmail(identity.email);
  if (linked && (!byEmail || linked.id !== byEmail.id)) {
    throw new AccountConflictError(
      'This Google account already signs in to another Bookmark Assistant account',
      'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
    );
  }
  if (byEmail?.googleSub && byEmail.googleSub !== identity.sub) {
    throw new AccountConflictError(
      'This email belongs to an account linked to a different Google identity',
      'GOOGLE_ACCOUNT_CONFLICT'
    );
  }

  if (!byEmail) {
    const created = await findOrCreateByVerifiedEmail(identity.email);
    const attached = await attachGoogleSubject(created.id, identity.sub, created.googleSub);
    return { ...attached, created: created.created };
  }

  const verified = await prisma.user.update({
    where: { id: byEmail.id },
    data: { emailVerifiedAt: new Date(), lastActivity: new Date() },
    select: accountSelect,
  });
  const attached = await attachGoogleSubject(verified.id, identity.sub, verified.googleSub);
  return { ...attached, created: false };
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
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: accountSelect,
  });
  if (!current) {
    throw new AccountConflictError(
      'This Google account already signs in to another Bookmark Assistant account',
      'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
    );
  }
  if (current.googleSub && current.googleSub !== identity.sub) {
    throw new AccountConflictError(
      'This email belongs to an account linked to a different Google identity',
      'GOOGLE_ACCOUNT_CONFLICT'
    );
  }
  const emailsMatch = current.email.trim().toLowerCase() === identity.email;
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        googleSub: identity.sub,
        lastActivity: new Date(),
        ...(emailsMatch ? { emailVerifiedAt: new Date() } : {}),
      },
      select: accountSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AccountConflictError(
        'This Google account already signs in to another Bookmark Assistant account',
        'GOOGLE_ACCOUNT_LINKED_ELSEWHERE'
      );
    }
    throw error;
  }
}

const NOTION_CONNECTION_RESET = {
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
