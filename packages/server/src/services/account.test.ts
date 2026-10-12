/**
 * Unit tests for the service account lifecycle.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  aiGenerationTask: { deleteMany: vi.fn() },
  aiGenerationBatch: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('./userPrisma', () => ({ prisma }));

import { deleteAccount, disconnectNotion, findAccountByEmail } from './account';

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
