/**
 * Unit tests for the service account lifecycle.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  aiProviderCredential: { deleteMany: vi.fn() },
  aiGenerationTask: { deleteMany: vi.fn() },
  aiGenerationBatch: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('./userPrisma', () => ({ prisma }));

import {
  deleteAccount,
  disconnectNotion,
  findAccountByEmail,
  findOrCreateByVerifiedEmail,
  linkGoogleIdentity,
  resolveGoogleAccount,
} from './account';

describe('service account lifecycle', () => {
  afterEach(() => vi.resetAllMocks());

  it('finds an account by email regardless of case', async () => {
    await findAccountByEmail('Person@Example.com');
    expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({
      equals: 'Person@Example.com',
      mode: 'insensitive',
    });
  });

  it('clears the Notion connection and its AI work but keeps the plan', async () => {
    await disconnectNotion('u1');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.aiGenerationTask.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prisma.aiGenerationBatch.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    const update = prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data).toMatchObject({ notionUserId: null, notionAccessToken: null });
    expect(update.data).not.toHaveProperty('plan');
    expect(update.data).not.toHaveProperty('subscriptionSource');
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes only the requested account', async () => {
    await deleteAccount('u1');
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });
});

describe('verified email account resolution', () => {
  afterEach(() => vi.resetAllMocks());

  it('adopts an existing Notion account and keeps its plan and stored key', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'notion-account',
      email: 'Person@Example.com',
      plan: 'pro',
      googleSub: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'notion-account',
      email: 'Person@Example.com',
      plan: 'pro',
      googleSub: null,
    });

    await expect(findOrCreateByVerifiedEmail('person@example.com')).resolves.toMatchObject({
      id: 'notion-account',
      plan: 'pro',
      created: false,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('plan');
    expect(prisma.aiProviderCredential.deleteMany).not.toHaveBeenCalled();
  });

  it('creates a Free account when the verified email is new', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-account', plan: 'free', googleSub: null });

    await findOrCreateByVerifiedEmail('New.Person@Example.com');
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      email: 'new.person@example.com',
      plan: 'free',
    });
  });
});

describe('Google account linking', () => {
  afterEach(() => vi.resetAllMocks());
  const identity = { sub: 'google-sub-1', email: 'person@example.com' };

  it('signs the existing email account in and records the Google subject', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'notion-account',
      plan: 'pro',
      googleSub: null,
      email: 'person@example.com',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.update.mockImplementation(async ({ data }: { data: object }) => ({
      id: 'notion-account',
      plan: 'pro',
      email: 'person@example.com',
      googleSub: null,
      ...data,
    }));

    await expect(resolveGoogleAccount(identity)).resolves.toMatchObject({
      id: 'notion-account',
      plan: 'pro',
      googleSub: 'google-sub-1',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses a Google subject that already belongs to another account', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'email-account',
      plan: 'free',
      googleSub: null,
      email: 'person@example.com',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'other-account', googleSub: 'google-sub-1' });
    prisma.user.update.mockResolvedValue({ id: 'email-account' });

    await expect(resolveGoogleAccount(identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_LINKED_ELSEWHERE',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update.mock.calls.some((call) => call[0].data?.googleSub)).toBe(false);
  });

  it('links Google onto the signed-in account when the verified email matches', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'signed-in',
      email: 'Person@Example.com',
      googleSub: null,
      plan: 'pro',
    });
    prisma.user.update.mockImplementation(async ({ data }: { data: object }) => ({
      id: 'signed-in',
      plan: 'pro',
      email: 'Person@Example.com',
      ...data,
    }));

    await expect(
      linkGoogleIdentity('signed-in', { sub: 'google-sub-1', email: ' person@example.com ' })
    ).resolves.toMatchObject({
      id: 'signed-in',
      googleSub: 'google-sub-1',
    });
    const update = prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'signed-in' });
    expect(update.data.googleSub).toBe('google-sub-1');
    expect(update.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(update.data).not.toHaveProperty('email');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not store a Google subject when the verified email differs', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'signed-in',
      email: 'owner@example.com',
      googleSub: null,
      plan: 'pro',
    });

    await expect(linkGoogleIdentity('signed-in', identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_CONFLICT',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses to replace a different Google subject already on the account', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'signed-in',
      email: 'person@example.com',
      googleSub: 'other-sub',
      plan: 'pro',
    });

    await expect(linkGoogleIdentity('signed-in', identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_CONFLICT',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses Google sign-in when the email account already has a different subject', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'email-account',
      plan: 'pro',
      googleSub: 'other-sub',
      email: 'person@example.com',
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(resolveGoogleAccount(identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_CONFLICT',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
