// One-time email sign-in codes. Only an HKDF-derived HMAC is stored.

import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { emailDeliveryMode, MailDeliveryError, sendLoginCode } from './mailer';
import { prisma } from './userPrisma';

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_CODE_DAILY_LIMIT = 10;
const EMAIL_CODE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL_CODE_KEY_INFO = 'bookmark-assistant/email-login-code/v1';

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export class EmailLoginCodeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMAIL_INVALID'
      | 'EMAIL_SIGN_IN_DISABLED'
      | 'EMAIL_CODE_RATE_LIMITED'
      | 'EMAIL_CODE_INVALID'
      | 'EMAIL_DELIVERY_FAILED'
  ) {
    super(message);
    this.name = 'EmailLoginCodeError';
  }
}

export function normalizeLoginEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function emailLoginCodeKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), EMAIL_CODE_KEY_INFO, 32)
  );
}

export function hashEmailLoginCode(email: string, code: string, secret: string): string {
  return createHmac('sha256', emailLoginCodeKey(secret)).update(`${email}:${code}`).digest('hex');
}

export function loginCodeHashesMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex);
  const actual = Buffer.from(actualHex);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const invalidCode = () =>
  new EmailLoginCodeError('The sign-in code is invalid or has expired.', 'EMAIL_CODE_INVALID');

export async function startEmailLogin(input: {
  email: string;
  locale?: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const email = normalizeLoginEmail(input.email);
  if (!email) {
    throw new EmailLoginCodeError('Enter a valid email address.', 'EMAIL_INVALID');
  }
  if (emailDeliveryMode() === 'disabled') {
    throw new EmailLoginCodeError(
      'Email sign-in is not enabled for this server.',
      'EMAIL_SIGN_IN_DISABLED'
    );
  }

  const sentToday = await prisma.emailLoginCode.count({
    where: { email, createdAt: { gte: new Date(now.getTime() - EMAIL_CODE_DAILY_WINDOW_MS) } },
  });
  if (sentToday >= EMAIL_CODE_DAILY_LIMIT) {
    throw new EmailLoginCodeError(
      'Please wait before requesting another sign-in code.',
      'EMAIL_CODE_RATE_LIMITED'
    );
  }
  const latest = await prisma.emailLoginCode.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < EMAIL_CODE_RESEND_COOLDOWN_MS) {
    throw new EmailLoginCodeError(
      'Please wait before requesting another sign-in code.',
      'EMAIL_CODE_RATE_LIMITED'
    );
  }

  const code = generateLoginCode();
  await prisma.emailLoginCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: now },
  });
  await prisma.emailLoginCode.create({
    data: {
      email,
      codeHash: hashEmailLoginCode(email, code, config.jwtSecret),
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
      createdAt: now,
    },
  });
  try {
    await sendLoginCode({ email, code, locale: input.locale });
  } catch (error) {
    if (error instanceof MailDeliveryError) {
      throw new EmailLoginCodeError(
        'The sign-in email could not be sent. Try again later.',
        'EMAIL_DELIVERY_FAILED'
      );
    }
    throw error;
  }
}

export async function verifyEmailLogin(input: {
  email: string;
  code: string;
  now?: Date;
}): Promise<{ email: string }> {
  const now = input.now ?? new Date();
  const email = normalizeLoginEmail(input.email);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) throw invalidCode();

  const active = await prisma.emailLoginCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) throw invalidCode();

  const matches = loginCodeHashesMatch(
    active.codeHash,
    hashEmailLoginCode(email, code, config.jwtSecret)
  );
  if (!matches) {
    const attempts = active.attempts + 1;
    await prisma.emailLoginCode.update({
      where: { id: active.id },
      data: {
        attempts,
        ...(attempts >= EMAIL_CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}),
      },
    });
    throw invalidCode();
  }

  await prisma.emailLoginCode.update({
    where: { id: active.id },
    data: { consumedAt: now },
  });
  return { email };
}

/** Keeps the last day of rows so the per-email send limit cannot be reset by cleanup. */
export async function deleteExpiredEmailLoginCodes(now = new Date()): Promise<number> {
  const result = await prisma.emailLoginCode.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - EMAIL_CODE_DAILY_WINDOW_MS) } },
  });
  return result.count;
}
