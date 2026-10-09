import express from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../config', () => ({
  config: {
    commerceEnabled: false,
    paddle: { environment: 'sandbox' },
    jwtSecret: 'fixture-jwt-secret',
  },
}));
vi.mock('../services/userPrisma', () => ({ prisma: {} }));
vi.mock('../utils', () => ({ auditLog: vi.fn() }));
import paddleRoutes from './paddle';

async function checkout(path: string, userId: string, authenticated = false) {
  const app = express();
  app.use(express.json());
  app.use('/api/paddle', paddleRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const token = jwt.sign({ userId: 'fixture-user' }, 'fixture-jwt-secret', { expiresIn: '1m' });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/paddle${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ userId, pricing: 'yearly' }),
    });
    return response.status;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe('checkout authentication and client rollout', () => {
  it('requires a session on the new checkout path', async () =>
    expect(await checkout('/checkout-url/v2', 'fixture-user')).toBe(401));
  it('rejects a checkout for another account', async () =>
    expect(await checkout('/checkout-url/v2', 'other-user', true)).toBe(403));
  it('keeps self-hosted commerce disabled for an authenticated user', async () =>
    expect(await checkout('/checkout-url/v2', 'fixture-user', true)).toBe(503));
  it('retains the old client route while keeping commerce disabled', async () =>
    expect(await checkout('/checkout-url', 'fixture-user')).toBe(503));
});
