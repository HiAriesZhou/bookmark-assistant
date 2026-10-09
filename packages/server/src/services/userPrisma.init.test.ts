/**
 * Unit tests for Prisma client initialization timing.
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('userPrisma initialization', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@prisma/client');
    vi.doUnmock('../config');
  });

  it('does not initialize Prisma during module import when DATABASE_URL is missing', async () => {
    const PrismaClient = vi.fn(() => ({ user: {} }));

    vi.doMock('@prisma/client', () => ({
      PrismaClient,
    }));
    vi.doMock('../config', () => ({
      config: {
        databaseUrl: undefined,
      },
    }));

    const { prisma } = await import('./userPrisma');

    expect(PrismaClient).not.toHaveBeenCalled();
    expect(() => (prisma as any).user).toThrow(/DATABASE_URL/);
    expect(PrismaClient).not.toHaveBeenCalled();
  });
});
