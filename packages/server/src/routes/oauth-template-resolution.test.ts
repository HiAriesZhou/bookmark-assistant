/**
 * Route-level tests for Notion OAuth template resolution.
 * @vitest-environment node
 */

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import oauthRoutes from './oauth';

const mocks = vi.hoisted(() => ({
  notionService: {
    exchangeOAuthCode: vi.fn(),
    resolveDatabaseFromTemplate: vi.fn(),
  },
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
  auditLog: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  validateExtension: (_req: any, _res: any, next: any) => next(),
  validateSession: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/notion', () => ({
  notionService: mocks.notionService,
}));

vi.mock('../services/userPrisma', () => ({
  prisma: mocks.prisma,
  userPrisma: {},
  userCompatSelect: {},
}));

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
  },
}));

vi.mock('../utils', () => ({
  auditLog: mocks.auditLog,
  sanitizeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', oauthRoutes);
  return app;
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);

  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('OAuth template resolution', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a typed error instead of a session when duplicated template resolution fails', async () => {
    const existingUser = {
      id: 'user-1',
      email: 'person@example.test',
      notionRefreshToken: 'old-refresh-token',
      plan: 'free',
    };

    mocks.notionService.exchangeOAuthCode.mockResolvedValue({
      access_token: 'notion-access-token',
      refresh_token: 'notion-refresh-token',
      workspace_id: 'workspace-1',
      duplicated_template_id: 'template-1',
      owner: {
        user: {
          id: 'notion-user-1',
          person: { email: 'person@example.test' },
        },
      },
    });
    mocks.notionService.resolveDatabaseFromTemplate.mockRejectedValue(
      new Error('No inline database found in template')
    );
    mocks.prisma.user.findUnique.mockResolvedValue(existingUser);
    mocks.prisma.user.update.mockResolvedValue(existingUser);

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/oauth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'oauth-code',
          redirectUri: 'https://extension-id.chromiumapp.org/callback',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body).toMatchObject({
        error: 'Template Database Resolution Failed',
        code: 'TEMPLATE_DATABASE_RESOLUTION_FAILED',
      });
      expect(body.sessionToken).toBeUndefined();
    });

    expect(mocks.auditLog).toHaveBeenCalledWith(
      'oauth_template_resolution_error',
      'user-1',
      expect.objectContaining({
        error: 'No inline database found in template',
        hasDuplicatedTemplateId: true,
      })
    );
    expect(mocks.auditLog).not.toHaveBeenCalledWith(
      'oauth_exchange_success',
      expect.any(String),
      expect.anything()
    );
  });

  it('persists the resolved database mapping and returns a session when resolution succeeds', async () => {
    const existingUser = {
      id: 'user-1',
      email: 'person@example.test',
      notionRefreshToken: 'old-refresh-token',
      plan: 'free',
    };

    mocks.notionService.exchangeOAuthCode.mockResolvedValue({
      access_token: 'notion-access-token',
      refresh_token: 'notion-refresh-token',
      workspace_id: 'workspace-1',
      duplicated_template_id: 'template-1',
      owner: {
        user: {
          id: 'notion-user-1',
          person: { email: 'person@example.test' },
        },
      },
    });
    mocks.notionService.resolveDatabaseFromTemplate.mockResolvedValue({
      databaseId: 'database-1',
      dataSourceId: 'data-source-1',
    });
    mocks.prisma.user.findUnique.mockResolvedValueOnce(existingUser).mockResolvedValueOnce({
      ...existingUser,
      templateDatabaseId: 'template-1',
    });
    mocks.prisma.user.update.mockResolvedValueOnce(existingUser).mockResolvedValueOnce({
      ...existingUser,
      templateDatabaseId: 'template-1',
      duplicatedTemplateId: 'template-1',
      notionDatabaseId: 'database-1',
      notionDataSourceId: 'data-source-1',
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/oauth/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'oauth-code',
          redirectUri: 'https://extension-id.chromiumapp.org/callback',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.sessionToken).toEqual(expect.any(String));
      expect(body.templateDatabaseId).toBe('template-1');
    });

    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          templateDatabaseId: 'template-1',
          duplicatedTemplateId: 'template-1',
          notionDatabaseId: 'database-1',
          notionDataSourceId: 'data-source-1',
        }),
      })
    );
  });
});
