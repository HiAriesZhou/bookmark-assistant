/**
 * Email and Google sign-in routes.
 * @vitest-environment node
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-jwt-secret-value';

const env = vi.hoisted(() => ({
  selfHosted: false,
  resendApiKey: 'test-resend-key',
  googleClientId: 'client.apps.googleusercontent.com',
  googleClientSecret: 'test-google-secret',
}));

const { EXTENSION_ID, users, codes, prisma } = vi.hoisted(() => {
  const EXTENSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  type UserRow = {
    id: string;
    email: string;
    plan: string;
    googleSub: string | null;
    notionAccessToken: string | null;
    emailVerifiedAt: Date | null;
  };
  type CodeRow = {
    id: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
    createdAt: Date;
  };
  const users: UserRow[] = [];
  const codes: CodeRow[] = [];
  function matchCode(row: CodeRow, where: Record<string, any> | undefined): boolean {
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
    user: {
      findFirst: vi.fn(async ({ where }: any) => {
        const expected = where?.email?.equals as string | undefined;
        return (
          users.find((user) => expected && user.email.toLowerCase() === expected.toLowerCase()) ??
          null
        );
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.find((user) => user.id === where.id) ?? null;
        if (where.googleSub)
          return users.find((user) => user.googleSub === where.googleSub) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: UserRow = {
          id: `user-${users.length + 1}`,
          plan: 'free',
          googleSub: null,
          notionAccessToken: null,
          emailVerifiedAt: null,
          ...data,
        };
        users.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = users.find((user) => user.id === where.id);
        if (!row) throw new Error('missing user');
        Object.assign(row, data);
        return row;
      }),
    },
    emailLoginCode: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const found = codes.filter((row) => matchCode(row, where));
        if (orderBy?.createdAt === 'desc') {
          found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return found[0] ?? null;
      }),
      count: vi.fn(async ({ where }: any) => codes.filter((row) => matchCode(row, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row: CodeRow = {
          id: `code-${codes.length + 1}`,
          attempts: 0,
          consumedAt: null,
          createdAt: data.createdAt ?? new Date(),
          ...data,
        };
        codes.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = codes.find((item) => item.id === where.id);
        if (!row) throw new Error('missing code');
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matched = codes.filter((row) => matchCode(row, where));
        matched.forEach((row) => Object.assign(row, data));
        return { count: matched.length };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { EXTENSION_ID, users, codes, prisma };
});

vi.mock('../config', () => ({
  config: {
    get selfHosted() {
      return env.selfHosted;
    },
    get resendApiKey() {
      return env.resendApiKey;
    },
    get googleClientId() {
      return env.googleClientId;
    },
    get googleClientSecret() {
      return env.googleClientSecret;
    },
    get emailFrom() {
      return 'Bookmark Assistant <login@bookmarkassistant.com>';
    },
    jwtSecret: 'test-jwt-secret-value',
    allowedExtensionIds: [EXTENSION_ID],
    rateLimits: {
      auth: { windowMs: 15 * 60 * 1000, max: 10 },
      api: { windowMs: 60 * 1000, max: 100 },
    },
  },
}));
vi.mock('../services/userPrisma', () => ({
  prisma,
  userPrisma: {
    resolveInternalUserId: async (id: string) => users.find((user) => user.id === id)?.id,
  },
}));
vi.mock('../utils', () => ({
  auditLog: vi.fn(),
  sanitizeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const exchangeGoogleCode = vi.hoisted(() => vi.fn());
vi.mock('../services/google-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/google-auth')>();
  return { ...actual, exchangeGoogleCode };
});

import authRoutes from './auth';

const httpRequest = globalThis.fetch.bind(globalThis);

let address = 10;

async function post(path: string, body: unknown, authorization?: string) {
  address += 1;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  try {
    const response = await httpRequest(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-ID': EXTENSION_ID,
        'X-Forwarded-For': `203.0.113.${address}`,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function issuedCode(email: string): Promise<string> {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const response = await post('/api/auth/email/start', { email });
  expect(response.status).toBe(202);
  const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
  const code = payload.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('test email did not contain a code');
  return code;
}

describe('auth routes', () => {
  afterEach(() => {
    users.splice(0, users.length);
    codes.splice(0, codes.length);
    env.selfHosted = false;
    env.resendApiKey = 'test-resend-key';
    env.googleClientId = 'client.apps.googleusercontent.com';
    env.googleClientSecret = 'test-google-secret';
    exchangeGoogleCode.mockReset();
    vi.unstubAllGlobals();
  });

  it('rejects a malformed email', async () => {
    const response = await post('/api/auth/email/start', { email: 'not-an-email' });
    expect(response.status).toBe(400);
    expect(codes).toHaveLength(0);
  });

  it('reports email sign-in as disabled on a hosted server without Resend', async () => {
    env.resendApiKey = '';
    const response = await post('/api/auth/email/start', { email: 'person@example.com' });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_SIGN_IN_DISABLED');
  });

  it('returns the same accepted response for registered and unknown emails', async () => {
    users.push({
      id: 'known',
      email: 'known@example.com',
      plan: 'pro',
      googleSub: null,
      notionAccessToken: null,
      emailVerifiedAt: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const known = await post('/api/auth/email/start', { email: 'known@example.com' });
    const unknown = await post('/api/auth/email/start', { email: 'unknown@example.com' });
    expect(known.status).toBe(202);
    expect(unknown).toEqual(known);
    expect(known.body).toEqual({ accepted: true });
    expect(users.map((user) => user.id)).toEqual(['known']);
  });

  it('logs a self-hosted code when Resend is not configured', async () => {
    env.selfHosted = true;
    env.resendApiKey = '';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await post('/api/auth/email/start', { email: 'person@example.com' });
    expect(response).toEqual({ status: 202, body: { accepted: true } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info.mock.calls.flat().join('\n')).toMatch(/\d{6}/);
    expect(info.mock.calls.flat().join('\n')).not.toContain('person@example.com');
  });

  it('signs in the existing Notion account and keeps the plan', async () => {
    users.push({
      id: 'notion-account',
      email: 'Person@Example.com',
      plan: 'pro',
      googleSub: null,
      notionAccessToken: 'notion-token',
      emailVerifiedAt: null,
    });
    const code = await issuedCode('person@example.com');
    const response = await post('/api/auth/email/verify', { email: 'PERSON@example.com', code });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      userId: 'notion-account',
      userEmail: 'Person@Example.com',
      accountCreated: false,
      hasNotionAccess: true,
    });
    expect(jwt.verify(response.body.sessionToken, JWT_SECRET)).toMatchObject({
      userId: 'notion-account',
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ plan: 'pro', notionAccessToken: 'notion-token' });
    expect(users[0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code', async () => {
    await issuedCode('person@example.com');
    const response = await post('/api/auth/email/verify', {
      email: 'person@example.com',
      code: '000000',
    });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('EMAIL_CODE_INVALID');
    expect(response.body.sessionToken).toBeUndefined();
  });

  it('rejects a Google redirect outside the extension allowlist before exchanging it', async () => {
    const response = await post('/api/auth/google/exchange', {
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: 'https://evil.example/google',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('GOOGLE_REDIRECT_REJECTED');
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it('rejects an unverified Google email', async () => {
    const { GoogleSignInError } = await import('../services/google-auth');
    exchangeGoogleCode.mockRejectedValue(
      new GoogleSignInError('unverified', 'GOOGLE_EMAIL_UNVERIFIED')
    );
    const response = await post('/api/auth/google/exchange', {
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: `https://${EXTENSION_ID}.chromiumapp.org/google`,
    });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  it('rejects a Google subject already linked to another account', async () => {
    users.push(
      {
        id: 'email-account',
        email: 'person@example.com',
        plan: 'free',
        googleSub: null,
        notionAccessToken: null,
        emailVerifiedAt: null,
      },
      {
        id: 'other-account',
        email: 'other@example.com',
        plan: 'pro',
        googleSub: 'google-sub-1',
        notionAccessToken: null,
        emailVerifiedAt: new Date(),
      }
    );
    exchangeGoogleCode.mockResolvedValue({ sub: 'google-sub-1', email: 'person@example.com' });
    const response = await post('/api/auth/google/exchange', {
      code: 'auth-code',
      codeVerifier: 'verifier',
      redirectUri: `https://${EXTENSION_ID}.chromiumapp.org/google`,
    });
    expect(response.status).toBe(409);
    expect(users.find((user) => user.id === 'email-account')?.googleSub).toBeNull();
    expect(users).toHaveLength(2);
  });

  it('links Google to the signed-in account instead of switching accounts', async () => {
    users.push({
      id: 'signed-in',
      email: 'owner@example.com',
      plan: 'pro',
      googleSub: null,
      notionAccessToken: 'notion-token',
      emailVerifiedAt: new Date(),
    });
    exchangeGoogleCode.mockResolvedValue({ sub: 'google-sub-9', email: 'other@example.com' });
    const response = await post(
      '/api/auth/google/exchange',
      {
        code: 'auth-code',
        codeVerifier: 'verifier',
        redirectUri: `https://${EXTENSION_ID}.chromiumapp.org/google`,
      },
      `Bearer ${jwt.sign({ userId: 'signed-in' }, JWT_SECRET)}`
    );
    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.sessionToken, JWT_SECRET)).toMatchObject({
      userId: 'signed-in',
    });
    expect(users).toHaveLength(1);
    expect(users[0].googleSub).toBe('google-sub-9');
    expect(users[0].plan).toBe('pro');
  });
});
