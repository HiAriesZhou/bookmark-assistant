import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveUser: vi.fn(), getSettings: vi.fn() }));
vi.mock('../services', async () => ({
  AiCredentialService: (await import('../services/ai-credential-service')).AiCredentialService,
}));
vi.mock('../utils', () => ({ auditLog: vi.fn(), resolveProEntitlement: () => ({ isPro: false }) }));
vi.mock('../config', () => ({ config: { aiCredentialEncryption: { available: false } } }));
vi.mock('../services/userPrisma', () => ({
  prisma: {},
  userPrisma: { resolveInternalUserId: mocks.resolveUser },
}));
vi.mock('../services/prisma-ai-settings-store', () => ({
  PrismaAiSettingsStore: class {
    resolveInternalUserId = mocks.resolveUser;
    get = mocks.getSettings;
  },
}));
vi.mock('../jobs/ai-diagnostic-cleanup', () => ({
  cleanupExpiredAiDiagnosticsOpportunistically: vi.fn().mockResolvedValue(undefined),
}));
import router from './ai';

// Invoke the production callback with Express's request/response/next contract.
// Catch its returned promise in the test so the baseline fails an assertion,
// rather than leaking an unhandled rejection into the test runner.
async function settingsRequest(method = 'get', path = '/settings') {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods[method]
  );
  const callback = layer.route.stack.at(-1).handle;
  const req = { user: { userId: 'test-user' } } as unknown as Request;
  const res = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as NextFunction;
  await Promise.resolve(callback(req, res, next)).catch(() => undefined);
  return { res, next };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveUser.mockResolvedValue('internal-user');
});

describe('AI settings error forwarding', () => {
  it('forwards a database rejection to Express error middleware', async () => {
    const error = new Error('synthetic database failure');
    mocks.getSettings.mockRejectedValue(error);
    const { res, next } = await settingsRequest();
    expect(next).toHaveBeenCalledExactlyOnceWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/settings'],
    ['get', '/recent-processing'],
    ['get', '/pending-summary'],
    ['post', '/batches/:batchId/confirm'],
    ['post', '/batches/:batchId/skip'],
  ])('forwards an account lookup rejection from %s %s', async (method, path) => {
    const error = new Error('synthetic account lookup failure');
    mocks.resolveUser.mockRejectedValue(error);
    const { res, next } = await settingsRequest(method, path);
    expect(next).toHaveBeenCalledExactlyOnceWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('preserves a successful settings response', async () => {
    const settings = { singlePageEnabled: true, batchEnabled: false };
    mocks.getSettings.mockResolvedValue(settings);
    const { res, next } = await settingsRequest();
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ success: true, settings });
    expect(next).not.toHaveBeenCalled();
  });
});
