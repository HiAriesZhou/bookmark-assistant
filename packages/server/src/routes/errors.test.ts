import express from 'express';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import errorRoutes from './errors';
import { PRODUCT_VERSION } from '../product-version.generated';

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/errors', errorRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server address unavailable');
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

afterEach(() => vi.restoreAllMocks());

function postJson(url: string, body: unknown): Promise<number> {
  const target = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode || 0));
      }
    );
    request.once('error', reject);
    request.end(payload);
  });
}

describe('extension error telemetry', () => {
  it('does not write bookmark titles or stack traces to server logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await withServer(async (baseUrl) => {
      const status = await postJson(`${baseUrl}/api/errors`, {
        message: 'Server sync failed: private bookmark title',
        stack: 'Error: private bookmark title',
        timestamp: '2026-08-19T09:00:00.000Z',
        version: PRODUCT_VERSION,
        context: { operation: 'sync', syncHash: 'sensitive-hash', bookmarkCount: 1 },
        userAgent: 'private user agent',
      });
      expect(status).toBe(200);
    });

    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).not.toContain('private bookmark title');
    expect(output).not.toContain('sensitive-hash');
    expect(output).not.toContain('private user agent');
    expect(errorSpy).toHaveBeenCalledWith(
      '[Extension Error]',
      expect.objectContaining({ category: 'sync_failure' })
    );
  });
});
