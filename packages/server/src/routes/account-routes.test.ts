/**
 * Route-level tests for account sign-in, Notion linking and account lifecycle.
 * @vitest-environment node
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { JWT_SECRET } = vi.hoisted(() => ({ JWT_SECRET: 'test-jwt-secret' }));

const mocks = vi.hoisted(() => ({
  notionService: { exchangeOAuthCode: vi.fn(), resolveDatabaseFromTemplate: vi.fn() },
  prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() } },
  userPrisma: { find: vi.fn(), resolveInternalUserId: vi.fn() },
  linkGoogleIdentity: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  resolveGoogleAccount: vi.fn(),
  disconnectNotion: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('../middleware/auth', async () => {
  const { default: jsonwebtoken } = await import('jsonwebtoken');
  return {
    validateExtension: (_req: any, _res: any, next: any) => next(),
    validateSession: (req: any, res: any, next: any) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      try {
        req.user = { userId: (jsonwebtoken.verify(token, JWT_SECRET) as any).userId };
      } catch {
        return res.status(401).json({ message: 'Invalid session token' });
      }
      next();
    },
  };
});
vi.mock('../services/notion', () => ({ notionService: mocks.notionService }));
vi.mock('../services/userPrisma', () => ({
  prisma: mocks.prisma,
  userPrisma: mocks.userPrisma,
  userCompatSelect: {},
}));
vi.mock('../config', () => ({
  config: { jwtSecret: JWT_SECRET, selfHosted: false, commerceEnabled: true },
}));
vi.mock('../utils', () => ({
  auditLog: vi.fn(),
  sanitizeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  resolveProEntitlement: () => ({ plan: 'free', isPro: false, subscriptionSource: null }),
}));
vi.mock('../services/google-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/google-auth')>()),
  exchangeGoogleCode: mocks.exchangeGoogleCode,
}));
vi.mock('../services/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/account')>()),
  resolveGoogleAccount: mocks.resolveGoogleAccount,
  linkGoogleIdentity: mocks.linkGoogleIdentity,
  disconnectNotion: mocks.disconnectNotion,
  deleteAccount: mocks.deleteAccount,
}));

import oauthRoutes from './oauth';
import userRoutes from './user';
import { GoogleSignInError } from '../services/google-auth';

const sessionFor = (userId: string) => `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;

async function call(method: string, path: string, body?: unknown, authorization?: string) {
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', oauthRoutes);
  app.use('/api/user', userRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const notionToken = {
  access_token: 'notion-access',
  refresh_token: 'notion-refresh',
  workspace_id: 'ws-1',
  owner: { user: { id: 'notion-1', person: { email: 'notion@example.com' } } },
};

describe('account routes', () => {
  afterEach(() => vi.resetAllMocks());

  it('signs in with Google and issues a renewable session', async () => {
    mocks.exchangeGoogleCode.mockResolvedValue({ sub: 'g1', email: 'p@example.com' });
    mocks.resolveGoogleAccount.mockResolvedValue({ id: 'acct-1', email: 'p@example.com' });

    const res = await call('POST', '/api/oauth/google', {
      code: 'c',
      redirectUri: 'https://ext.chromiumapp.org/google',
      codeVerifier: 'v',
    });

    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.sessionToken, JWT_SECRET)).toMatchObject({ userId: 'acct-1' });
    const { exp, iat } = jwt.decode(res.body.sessionToken) as { exp: number; iat: number };
    expect(exp - iat).toBe(14 * 24 * 60 * 60);
  });

  it('requires the PKCE verifier for Google sign-in', async () => {
    const res = await call('POST', '/api/oauth/google', { code: 'c', redirectUri: 'r' });
    expect(res.status).toBe(400);
    expect(mocks.exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it('reports an unconfigured Google sign-in as unavailable', async () => {
    mocks.exchangeGoogleCode.mockRejectedValue(
      new GoogleSignInError('off', 'GOOGLE_SIGN_IN_UNAVAILABLE')
    );
    const res = await call('POST', '/api/oauth/google', {
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
    });
    expect(res).toMatchObject({ status: 503, body: { code: 'GOOGLE_SIGN_IN_UNAVAILABLE' } });
  });

  it('renews the session of an existing account', async () => {
    mocks.userPrisma.find.mockResolvedValue({ id: 'acct-1' });
    const res = await call('POST', '/api/oauth/session', undefined, sessionFor('acct-1'));
    expect(res.status).toBe(200);
    expect(jwt.verify(res.body.sessionToken, JWT_SECRET)).toMatchObject({ userId: 'acct-1' });
  });

  it('refuses to renew a session for a deleted account', async () => {
    mocks.userPrisma.find.mockResolvedValue(undefined);
    const res = await call('POST', '/api/oauth/session', undefined, sessionFor('gone'));
    expect(res.status).toBe(401);
  });

  it('links Notion to the signed-in account instead of creating another one', async () => {
    mocks.notionService.exchangeOAuthCode.mockResolvedValue(notionToken);
    mocks.userPrisma.resolveInternalUserId.mockResolvedValue('acct-1');
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(null) // Notion user not linked yet
      .mockResolvedValueOnce({ id: 'acct-1', email: 'google@example.com' });
    mocks.prisma.user.update.mockResolvedValue({ id: 'acct-1', plan: 'pro' });

    const res = await call(
      'POST',
      '/api/oauth/exchange',
      { code: 'c', redirectUri: 'r' },
      sessionFor('acct-1')
    );

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'acct-1' },
      data: { notionUserId: 'notion-1', notionAccessToken: 'notion-access' },
    });
    expect(res.body.userEmail).toBe('google@example.com');
  });

  it('refuses to move a Notion account that belongs to another account', async () => {
    mocks.notionService.exchangeOAuthCode.mockResolvedValue(notionToken);
    mocks.userPrisma.resolveInternalUserId.mockResolvedValue('acct-1');
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ id: 'acct-2' });

    const res = await call(
      'POST',
      '/api/oauth/exchange',
      { code: 'c', redirectUri: 'r' },
      sessionFor('acct-1')
    );

    expect(res).toMatchObject({ status: 409, body: { code: 'NOTION_ACCOUNT_LINKED_ELSEWHERE' } });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid session instead of silently creating a Notion account', async () => {
    const res = await call(
      'POST',
      '/api/oauth/exchange',
      { code: 'c', redirectUri: 'r' },
      'Bearer forged'
    );
    expect(res.status).toBe(401);
    expect(mocks.notionService.exchangeOAuthCode).not.toHaveBeenCalled();
  });

  it('treats the legacy logout call as a Notion disconnect that keeps the account', async () => {
    mocks.userPrisma.find.mockResolvedValue({ id: 'acct-1' });
    const res = await call('POST', '/api/user/logout', undefined, sessionFor('acct-1'));
    expect(res.status).toBe(200);
    expect(mocks.disconnectNotion).toHaveBeenCalledWith('acct-1');
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it('links Notion for a pre-1.5.0 session that carries the Notion user ID', async () => {
    mocks.notionService.exchangeOAuthCode.mockResolvedValue(notionToken);
    mocks.userPrisma.resolveInternalUserId.mockResolvedValue('acct-1');
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'acct-1' })
      .mockResolvedValueOnce({ id: 'acct-1', email: 'notion@example.com' });
    mocks.prisma.user.update.mockResolvedValue({ id: 'acct-1' });

    const res = await call(
      'POST',
      '/api/oauth/exchange',
      { code: 'c', redirectUri: 'r' },
      sessionFor('notion-1')
    );

    expect(res.status).toBe(200);
    expect(mocks.userPrisma.resolveInternalUserId).toHaveBeenCalledWith('notion-1');
    expect(jwt.verify(res.body.sessionToken, JWT_SECRET)).toMatchObject({ userId: 'acct-1' });
  });

  it('adopts an existing account case-insensitively when signing in through Notion', async () => {
    mocks.notionService.exchangeOAuthCode.mockResolvedValue({
      ...notionToken,
      owner: { user: { id: 'notion-1', person: { email: 'Person@Example.com' } } },
    });
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'acct-1', email: 'person@example.com' });
    mocks.prisma.user.findFirst.mockResolvedValue({ id: 'acct-1' });
    mocks.prisma.user.update.mockResolvedValue({ id: 'acct-1' });

    const res = await call('POST', '/api/oauth/exchange', { code: 'c', redirectUri: 'r' });

    expect(res.status).toBe(200);
    expect(mocks.prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({
      equals: 'Person@Example.com',
      mode: 'insensitive',
    });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('adds Google sign-in to the signed-in account instead of switching accounts', async () => {
    mocks.userPrisma.resolveInternalUserId.mockResolvedValue('acct-1');
    mocks.exchangeGoogleCode.mockResolvedValue({ sub: 'g1', email: 'other@example.com' });
    mocks.linkGoogleIdentity.mockResolvedValue({ id: 'acct-1', email: 'notion@example.com' });

    const res = await call(
      'POST',
      '/api/oauth/google',
      { code: 'c', redirectUri: 'r', codeVerifier: 'v' },
      sessionFor('acct-1')
    );

    expect(res.status).toBe(200);
    expect(mocks.linkGoogleIdentity).toHaveBeenCalledWith('acct-1', {
      sub: 'g1',
      email: 'other@example.com',
    });
    expect(mocks.resolveGoogleAccount).not.toHaveBeenCalled();
  });

  it('disconnects Notion without deleting the account', async () => {
    mocks.userPrisma.find.mockResolvedValue({ id: 'acct-1' });
    const res = await call('POST', '/api/user/notion/disconnect', undefined, sessionFor('acct-1'));
    expect(res.status).toBe(200);
    expect(mocks.disconnectNotion).toHaveBeenCalledWith('acct-1');
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes the account only through the explicit endpoint', async () => {
    mocks.userPrisma.find.mockResolvedValue({ id: 'acct-1' });
    const res = await call('DELETE', '/api/user/account', undefined, sessionFor('acct-1'));
    expect(res.status).toBe(200);
    expect(mocks.deleteAccount).toHaveBeenCalledWith('acct-1');
  });
});
