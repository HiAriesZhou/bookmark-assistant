/**
 * Public deployment profile, including which sign-in methods are enabled.
 * @vitest-environment node
 */

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  selfHosted: false,
  resendApiKey: '',
  googleClientId: '',
  googleClientSecret: '',
}));

vi.mock('../config', () => ({
  config: {
    get selfHosted() {
      return state.selfHosted;
    },
    commerceEnabled: true,
    get resendApiKey() {
      return state.resendApiKey;
    },
    get googleClientId() {
      return state.googleClientId;
    },
    get googleClientSecret() {
      return state.googleClientSecret;
    },
    jwtSecret: 'test-jwt-secret',
    allowedExtensionIds: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  },
}));

import deploymentRoutes from './deployment';

async function get(authorization?: string) {
  const app = express();
  app.use('/api/deployment', deploymentRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/deployment`, {
      headers: {
        'X-Extension-ID': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
    return { status: response.status, body: (await response.json()) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('GET /api/deployment', () => {
  afterEach(() => {
    state.selfHosted = false;
    state.resendApiKey = '';
    state.googleClientId = '';
    state.googleClientSecret = '';
  });

  it('is readable without a session and lists Notion only when email and Google are off', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      deploymentMode: 'hosted',
      commerceEnabled: true,
      capabilities: { autoSync: false, batchAi: false },
      signInMethods: ['notion'],
    });
  });

  it('offers email on a self-hosted server and Google when both client credentials exist', async () => {
    state.selfHosted = true;
    expect((await get()).body.signInMethods).toEqual(['email', 'notion']);
    state.googleClientId = 'client.apps.googleusercontent.com';
    state.googleClientSecret = 'test-google-secret';
    expect((await get()).body.signInMethods).toEqual(['email', 'google', 'notion']);
    expect((await get()).body.capabilities).toEqual({ autoSync: true, batchAi: true });
  });
});
