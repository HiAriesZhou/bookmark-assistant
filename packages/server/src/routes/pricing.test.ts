import express from 'express';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPricing: vi.fn(),
  selfHosted: false,
}));

vi.mock('../config', () => ({
  config: {
    get selfHosted() {
      return mocks.selfHosted;
    },
    pricing: { monthlyFallback: 1.5, yearlyFallback: 11.9 },
  },
}));

vi.mock('../services', () => ({
  paddlePricingService: { getPricing: mocks.getPricing },
}));

import pricingRoutes, { withinPricingResponseBudget } from './pricing';

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/pricing', pricingRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode || 0, body: JSON.parse(body) })
      );
    });
    request.on('error', reject);
    request.end();
  });
}

describe('public pricing route', () => {
  afterEach(() => {
    mocks.selfHosted = false;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('does not request Paddle prices for self-hosted deployments', async () => {
    mocks.selfHosted = true;
    await withServer(async (baseUrl) => {
      const response = await getJson(`${baseUrl}/api/pricing`);
      expect(response.status).toBe(404);
      expect(mocks.getPricing).not.toHaveBeenCalled();
    });
  });

  it('returns recurring amounts plus currency and source', async () => {
    mocks.getPricing.mockResolvedValue({
      monthly: 1.5,
      yearly: 15,
      currencyCode: 'USD',
      source: 'paddle',
    });

    await withServer(async (baseUrl) => {
      const response = await getJson(`${baseUrl}/api/pricing`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        pricing: {
          monthly: 1.5,
          yearly: 15,
          currencyCode: 'USD',
          source: 'paddle',
        },
      });
    });
  });

  it('marks route-level fallback pricing as non-live', async () => {
    mocks.getPricing.mockRejectedValue(new Error('Paddle unavailable'));

    await withServer(async (baseUrl) => {
      const response = await getJson(`${baseUrl}/api/pricing`);
      expect(response.body.pricing).toMatchObject({
        monthly: 1.5,
        yearly: 11.9,
        currencyCode: 'USD',
        source: 'configured-fallback',
      });
    });
  });

  it('bounds a stalled commerce request before the extension watchdog expires', async () => {
    vi.useFakeTimers();
    const pending = withinPricingResponseBudget(new Promise<never>(() => {}));
    const assertion = expect(pending).rejects.toThrow('Pricing provider exceeded 1500ms budget');
    await vi.advanceTimersByTimeAsync(1_500);
    await assertion;
  });
});
