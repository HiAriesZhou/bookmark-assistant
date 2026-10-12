/**
 * Unit tests for account resolution across sign-in methods.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
}));

vi.mock('./userPrisma', () => ({ prisma }));

import { linkGoogleIdentity, resolveGoogleAccount } from './account';

const identity = { sub: 'google-sub-1', email: 'person@example.com' };

describe('resolveGoogleAccount', () => {
  afterEach(() => vi.resetAllMocks());

  it('signs in the account already linked to the Google subject', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', googleSub: 'google-sub-1' });
    prisma.user.update.mockResolvedValue({ id: 'u1' });

    await expect(resolveGoogleAccount(identity)).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('adopts an existing Notion, Paddle or granted account by verified email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', googleSub: null, plan: 'pro' });
    prisma.user.update.mockResolvedValue({ id: 'u2', plan: 'pro' });

    await expect(resolveGoogleAccount(identity)).resolves.toMatchObject({ id: 'u2', plan: 'pro' });
    expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({
      equals: 'person@example.com',
      mode: 'insensitive',
    });
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'u2' },
      data: { googleSub: 'google-sub-1' },
    });
  });

  it('refuses an email account already bound to another Google subject', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: 'u3', googleSub: 'other-sub' });

    await expect(resolveGoogleAccount(identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_CONFLICT',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('creates a Free account for a new person', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u4', plan: 'free' });

    await resolveGoogleAccount(identity);
    expect(prisma.user.create.mock.calls[0][0].data).toEqual({
      email: 'person@example.com',
      googleSub: 'google-sub-1',
      plan: 'free',
    });
  });
});

describe('linkGoogleIdentity', () => {
  afterEach(() => vi.resetAllMocks());

  it('refuses a Google identity that signs in to another account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(linkGoogleIdentity('u1', identity)).rejects.toMatchObject({
      code: 'GOOGLE_ACCOUNT_LINKED_ELSEWHERE',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('links the Google subject to the signed-in account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    await linkGoogleIdentity('u1', identity);
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'u1' },
      data: { googleSub: 'google-sub-1' },
    });
  });
});
