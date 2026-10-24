import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredAiProviderCredential } from '../services/ai-credential-service';

const mocks = vi.hoisted(() => ({
  records: new Map<string, StoredAiProviderCredential>(),
  auditLog: vi.fn(),
}));
vi.mock('../services', async () => ({
  AiCredentialService: (await import('../services/ai-credential-service')).AiCredentialService,
}));
vi.mock('../utils', () => ({
  auditLog: mocks.auditLog,
  resolveProEntitlement: () => ({ isPro: false }),
}));
vi.mock('../config', () => ({
  config: {
    selfHosted: false,
    aiCredentialEncryption: {
      available: true,
      activeKeyVersion: 1,
      keys: new Map([[1, randomBytes(32)]]),
    },
  },
}));
vi.mock('../services/userPrisma', () => ({ prisma: {}, userPrisma: {} }));
vi.mock('../services/prisma-ai-credential-store', () => ({
  PrismaAiCredentialStore: class {
    async resolveInternalUserId(userId: string) {
      return `internal-${userId}`;
    }
    async findCredential(userId: string) {
      return mocks.records.get(userId);
    }
    async saveCredential(credential: StoredAiProviderCredential) {
      mocks.records.set(credential.userId, credential);
    }
    async deleteCredential(userId: string) {
      mocks.records.delete(userId);
    }
    async stopTasksForDeletedCredential() {}
    async reconcileTasksWithActiveCredential() {}
  },
}));
vi.mock('../services/ai-provider-control-service', () => ({
  AiProviderControlService: class {
    async isAllowed() {
      return true;
    }
  },
  PrismaAiProviderControlStore: class {},
}));
vi.mock('../jobs/ai-diagnostic-cleanup', () => ({
  cleanupExpiredAiDiagnosticsOpportunistically: vi.fn().mockResolvedValue(undefined),
}));
import router from './ai';

// Synthetic, low-entropy fixture shaped like a DeepSeek key.
const DEEPSEEK_SHAPED_KEY = `sk-${'0'.repeat(32)}`;

function stubProviders(acceptingHost?: string) {
  const fetcher = vi.fn(async (input: string) => {
    const host = new URL(input).host;
    return new Response('{}', { status: host === acceptingHost ? 200 : 401 });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

async function putCredential(body: Record<string, unknown>) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/credential' && entry.route.methods.put
  );
  const callback = layer.route.stack.at(-1).handle;
  const req = { user: { userId: 'user-a' }, body } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, payload: unknown) {
      this.body = payload;
      return this;
    }),
  };
  const next = vi.fn() as NextFunction;
  await callback(req, res as unknown as Response, next);
  return { res, next };
}

beforeEach(() => {
  mocks.records.clear();
  mocks.auditLog.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PUT /credential auto-detection', () => {
  it('saves a key without a client-selected provider and returns the detected identity', async () => {
    const fetcher = stubProviders('api.deepseek.com');

    const { res, next } = await putCredential({ apiKey: DEEPSEEK_SHAPED_KEY });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      credential: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        host: 'api.deepseek.com',
        baseUrl: null,
        keyLastFour: '0000',
        status: 'verified',
      },
    });
    const probedHosts = fetcher.mock.calls.map(([url]) => new URL(url).host).sort();
    expect(probedHosts).toEqual(['api.deepseek.com', 'api.minimax.io', 'api.openai.com']);
    expect(mocks.records.get('internal-user-a')?.provider).toBe('deepseek');
    expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain(DEEPSEEK_SHAPED_KEY);
  });

  it('returns a recoverable error that allows a Base URL when no provider accepts the key', async () => {
    stubProviders();

    const { res } = await putCredential({ apiKey: DEEPSEEK_SHAPED_KEY });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'provider_not_detected', baseUrlAllowed: true });
    expect(mocks.records.size).toBe(0);
  });

  it('uses an official Base URL as a provider hint', async () => {
    const fetcher = stubProviders('api.anthropic.com');

    const { res } = await putCredential({
      apiKey: 'new-style-key',
      baseUrl: 'https://api.anthropic.com',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      credential: { provider: 'anthropic', host: 'api.anthropic.com', baseUrl: null },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects a Base URL outside the hosted endpoint policy before contacting providers', async () => {
    const fetcher = stubProviders('api.openai.com');

    const { res } = await putCredential({
      apiKey: DEEPSEEK_SHAPED_KEY,
      baseUrl: 'http://127.0.0.1:4000/v1',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_base_url' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps accepting an explicit provider from older extension builds', async () => {
    const fetcher = stubProviders('generativelanguage.googleapis.com');

    const { res } = await putCredential({ provider: 'gemini', apiKey: 'legacy-client-key' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ credential: { provider: 'gemini' } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects a missing key', async () => {
    stubProviders();
    const { res } = await putCredential({ apiKey: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_credential_input' });
  });
});
