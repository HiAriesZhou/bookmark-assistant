/**
 * Email one-time code rules. Codes are hashed; the plaintext never meets the database.
 * @vitest-environment node
 */

import { createHmac, hkdfSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const codeSequence = vi.hoisted(() => ({ next: 424242 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: () => codeSequence.next++,
  };
});

const { rows, userCalls, prisma } = vi.hoisted(() => {
  type CodeRow = {
    id: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
    createdAt: Date;
  };
  const rows: CodeRow[] = [];
  const userCalls = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() };
  function match(row: CodeRow, where: Record<string, any> | undefined): boolean {
    if (!where) return true;
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.email !== undefined && row.email !== where.email) return false;
    if ('consumedAt' in where && where.consumedAt === null && row.consumedAt !== null) return false;
    if (where.expiresAt?.gt && row.expiresAt.getTime() <= where.expiresAt.gt.getTime())
      return false;
    if (where.createdAt?.gte && row.createdAt.getTime() < where.createdAt.gte.getTime())
      return false;
    if (where.createdAt?.lt && row.createdAt.getTime() >= where.createdAt.lt.getTime())
      return false;
    return true;
  }
  const prisma = {
    emailLoginCode: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const found = rows.filter((row) => match(row, where));
        if (orderBy?.createdAt === 'desc') {
          found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return found[0] ?? null;
      }),
      count: vi.fn(async ({ where }: any) => rows.filter((row) => match(row, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row: CodeRow = {
          id: `code-${rows.length + 1}`,
          attempts: 0,
          consumedAt: null,
          ...data,
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing code');
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matched = rows.filter((row) => match(row, where));
        matched.forEach((row) => Object.assign(row, data));
        return { count: matched.length };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const kept = rows.filter((row) => !match(row, where));
        const count = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return { count };
      }),
    },
    user: userCalls,
  };
  return { rows, userCalls, prisma };
});

vi.mock('./userPrisma', () => ({ prisma }));
vi.mock('../config', () => ({
  config: { jwtSecret: 'test-jwt-secret-value', selfHosted: false },
}));
vi.mock('./mailer', () => ({
  emailDeliveryMode: vi.fn(() => 'resend'),
  sendLoginCode: vi.fn(async () => 'sent'),
}));

import { emailDeliveryMode, sendLoginCode } from './mailer';
import {
  deleteExpiredEmailLoginCodes,
  startEmailLogin,
  verifyEmailLogin,
} from './email-login-code';

function expectedCodeHash(email: string, code: string): string {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret),
      Buffer.alloc(0),
      'bookmark-assistant/email-login-code/v1',
      32
    )
  );
  return createHmac('sha256', key).update(`${email}:${code}`).digest('hex');
}

const start = new Date('2026-10-22T00:00:00.000Z');
const secret = 'test-jwt-secret-value';

function loggedText(): string {
  return ['log', 'info', 'warn', 'error', 'debug']
    .flatMap((method) => vi.mocked(console[method as 'log']).mock.calls)
    .flat()
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
}

describe('email login codes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rows.splice(0, rows.length);
    codeSequence.next = 424242;
    vi.clearAllMocks();
    vi.mocked(emailDeliveryMode).mockReturnValue('resend');
    vi.restoreAllMocks();
  });

  it('stores an HKDF-derived HMAC and never the plaintext code', async () => {
    await startEmailLogin({ email: 'Person@Example.com', now: start });
    const stored = rows[0];
    expect(stored.email).toBe('person@example.com');
    expect(stored.codeHash).toBe(expectedCodeHash('person@example.com', '424242'));
    expect(stored.codeHash).not.toBe('424242');
    expect(stored.codeHash).not.toBe(
      createHmac('sha256', secret).update('person@example.com:424242').digest('hex')
    );
    expect(JSON.stringify(stored)).not.toContain('424242');
    expect(loggedText()).not.toContain('424242');
    expect(userCalls.findFirst).not.toHaveBeenCalled();
    expect(userCalls.findUnique).not.toHaveBeenCalled();
    expect(userCalls.create).not.toHaveBeenCalled();
  });

  it('accepts the matching code and rejects a different one', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    await expect(
      verifyEmailLogin({ email: 'PERSON@example.com', code: '424242', now: start })
    ).resolves.toEqual({ email: 'person@example.com' });
    expect(rows[0].consumedAt).toEqual(start);

    rows[0].consumedAt = null;
    await expect(
      verifyEmailLogin({ email: 'person@example.com', code: '000000', now: start })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].consumedAt).toBeNull();
  });

  it('rejects an expired code without revealing why', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    const later = new Date(start.getTime() + 10 * 60 * 1000 + 1);
    await expect(
      verifyEmailLogin({ email: 'person@example.com', code: '424242', now: later })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
  });

  it('retires a code after five failed attempts', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyEmailLogin({ email: 'person@example.com', code: '000000', now: start })
      ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    }
    expect(rows[0].consumedAt).toEqual(start);
    await expect(
      verifyEmailLogin({ email: 'person@example.com', code: '424242', now: start })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
  });

  it('invalidates the previous code when a new one is issued', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    const later = new Date(start.getTime() + 61_000);
    await startEmailLogin({ email: 'person@example.com', now: later });
    expect(rows[0].consumedAt).toEqual(later);
    await expect(
      verifyEmailLogin({ email: 'person@example.com', code: '424242', now: later })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_INVALID' });
    await expect(
      verifyEmailLogin({ email: 'person@example.com', code: '424243', now: later })
    ).resolves.toEqual({ email: 'person@example.com' });
  });

  it('allows one send per minute and ten sends per day for an email', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    await expect(
      startEmailLogin({ email: 'person@example.com', now: new Date(start.getTime() + 59_000) })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_RATE_LIMITED' });

    let cursor = start.getTime();
    for (let index = 1; index < 10; index += 1) {
      cursor += 61_000;
      await startEmailLogin({ email: 'person@example.com', now: new Date(cursor) });
    }
    await expect(
      startEmailLogin({ email: 'person@example.com', now: new Date(cursor + 61_000) })
    ).rejects.toMatchObject({ code: 'EMAIL_CODE_RATE_LIMITED' });
    expect(sendLoginCode).toHaveBeenCalledTimes(10);
  });

  it('rejects a malformed email before storing a code', async () => {
    await expect(startEmailLogin({ email: 'not-an-email', now: start })).rejects.toMatchObject({
      code: 'EMAIL_INVALID',
    });
    expect(rows).toHaveLength(0);
  });

  it('does not send when email sign-in is disabled', async () => {
    vi.mocked(emailDeliveryMode).mockReturnValue('disabled');
    await expect(
      startEmailLogin({ email: 'person@example.com', now: start })
    ).rejects.toMatchObject({ code: 'EMAIL_SIGN_IN_DISABLED' });
    expect(rows).toHaveLength(0);
    expect(sendLoginCode).not.toHaveBeenCalled();
  });

  it('removes code records only after the daily window used for rate limits', async () => {
    await startEmailLogin({ email: 'person@example.com', now: start });
    await expect(deleteExpiredEmailLoginCodes(new Date(start.getTime() + 60_000))).resolves.toBe(0);
    expect(rows).toHaveLength(1);
    await expect(
      deleteExpiredEmailLoginCodes(new Date(start.getTime() + 24 * 60 * 60 * 1000 + 1))
    ).resolves.toBe(1);
    expect(rows).toHaveLength(0);
  });
});
