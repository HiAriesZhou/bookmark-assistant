import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  selfHosted: false,
  commerceEnabled: true,
  user: { plan: 'free', subscriptionSource: null as string | null },
}));
vi.mock('../config', () => ({
  config: {
    get selfHosted() {
      return state.selfHosted;
    },
    get commerceEnabled() {
      return state.commerceEnabled;
    },
    developerEmails: [],
  },
}));
vi.mock('../services/userPrisma', () => ({
  userPrisma: { find: vi.fn(async () => state.user) },
  prisma: {},
}));
vi.mock('../middleware/auth', () => ({
  validateSession: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'fixture-user' };
    next();
  },
}));
vi.mock('../utils', async () => ({
  ...(await vi.importActual('../utils/entitlements')),
  auditLog: vi.fn(),
  sanitizeError: () => 'fixture error',
}));
vi.mock('./oauth', async () => ({ default: (await import('express')).Router() }));
vi.mock('./notion', async () => ({ default: (await import('express')).Router() }));
vi.mock('./bookmarks', async () => ({ default: (await import('express')).Router() }));
vi.mock('./paddle', async () => ({ default: (await import('express')).Router() }));
vi.mock('./pricing', async () => ({ default: (await import('express')).Router() }));
vi.mock('./errors', async () => ({ default: (await import('express')).Router() }));
vi.mock('./ai', async () => ({ default: (await import('express')).Router() }));
import routes from './index';

async function request(path: string) {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe('deployment profile and HTTP administration boundary', () => {
  afterEach(() => {
    state.selfHosted = false;
    state.commerceEnabled = true;
    state.user = { plan: 'free', subscriptionSource: null };
  });
  it('keeps hosted Free capabilities locked despite a client-supplied mode', async () => {
    const { body } = await request('/api/user/profile?deploymentMode=self-hosted');
    expect(body.profile).toMatchObject({
      deploymentMode: 'hosted',
      commerceEnabled: true,
      isPro: false,
      capabilities: { autoSync: false, batchAi: false },
    });
  });
  it('reports self-hosting without a fictional developer subscription', async () => {
    state.selfHosted = true;
    state.commerceEnabled = false;
    const { body } = await request('/api/user/profile');
    expect(body.profile).toMatchObject({
      deploymentMode: 'self-hosted',
      commerceEnabled: false,
      isPro: true,
      subscriptionSource: null,
      capabilities: { autoSync: true, batchAi: true },
    });
  });
  it('preserves hosted paid capabilities', async () => {
    state.user = { plan: 'pro', subscriptionSource: 'paddle' };
    expect((await request('/api/user/profile')).body.profile.capabilities).toEqual({
      autoSync: true,
      batchAi: true,
    });
  });
  it.each(['/api/admin/cache', '/api/admin/cache/stats', '/api/admin/cache/cleanup'])(
    'does not expose cache administration to authenticated HTTP clients: %s',
    async (path) => {
      expect((await request(path)).status).toBe(404);
    }
  );
});
