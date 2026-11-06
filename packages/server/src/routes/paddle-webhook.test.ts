import crypto from 'node:crypto';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  secret: 'synthetic-webhook-secret',
  update: vi.fn().mockResolvedValue({}),
  findFirst: vi.fn().mockResolvedValue(null),
}));
vi.mock('../config', () => ({
  config: {
    commerceEnabled: true,
    paddle: {
      environment: 'sandbox',
      apiKey: 'synthetic-api-key',
      webhookSecret: fixture.secret,
      priceIds: { proMonthly: 'pri_fixture_monthly', proYearly: 'pri_fixture_yearly' },
    },
  },
}));
vi.mock('../services/userPrisma', () => ({
  prisma: {
    user: {
      update: fixture.update,
      findFirst: fixture.findFirst,
    },
  },
}));
vi.mock('../utils', () => ({ auditLog: vi.fn() }));
import paddleRoutes from './paddle';

const path = '/api/paddle/webhooks/paddle';
const event = {
  event_id: 'evt_fixture',
  event_type: 'subscription.activated',
  occurred_at: '2026-11-06T00:00:00Z',
  notification_id: 'ntf_fixture',
  data: {
    id: 'sub_fixture',
    status: 'active',
    customer_id: 'ctm_fixture',
    custom_data: { userId: 'fixture-user', pricing: 'monthly' },
  },
};
function signature(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const hash = crypto
    .createHmac('sha256', fixture.secret)
    .update(`${timestamp}:${body}`)
    .digest('hex');
  return `ts=${timestamp};h1=${hash}`;
}
async function deliver(body: string, header?: string, parsed = false) {
  const app = express();
  if (!parsed) app.use(path, express.raw({ type: 'application/json', limit: '1mb' }));
  app.use(express.json());
  app.use('/api/paddle', paddleRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(header ? { 'Paddle-Signature': header } : {}),
      },
      body,
    });
    return response.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
afterEach(() => vi.clearAllMocks());
describe('Paddle webhook authentication', () => {
  it('rejects a forged event even when upstream has already parsed the body', async () => {
    expect(await deliver(JSON.stringify(event), 'forged', true)).toBe(400);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('accepts an authentic raw body and updates the subscription', async () => {
    const body = JSON.stringify(event, null, 2);
    expect(await deliver(body, signature(body))).toBe(200);
    expect(fixture.update).toHaveBeenCalledOnce();
  });
  it('rejects tampered bytes, missing headers, malformed signatures and old timestamps', async () => {
    const body = JSON.stringify(event);
    for (const header of [
      undefined,
      'forged',
      signature(body + ' '),
      signature(body, Math.floor(Date.now() / 1000) - 60),
    ]) {
      expect(await deliver(body, header)).toBe(400);
    }
    expect(fixture.update).not.toHaveBeenCalled();
  });
});
