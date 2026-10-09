/**
 * @vitest-environment node
 */
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock, httpRequestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  httpRequestMock: vi.fn(),
}));

vi.mock('dns/promises', () => ({ lookup: lookupMock }));
vi.mock('http', () => ({ request: httpRequestMock }));
vi.mock('https', () => ({ request: httpRequestMock }));

import { fetchPublicHtml, PublicPageFetchError } from './public-page-fetcher';

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Delay before response headers arrive. */
  delayMs?: number;
  /** Leave the body open instead of ending it. */
  streaming?: boolean;
};

const createdResponses: PassThrough[] = [];

/** Each call to http(s).request answers with the next fake response. */
function respondWith(...responses: FakeResponse[]) {
  const queue = [...responses];
  httpRequestMock.mockImplementation((_url, _options, onResponse) => {
    const next = queue.shift();
    if (!next) throw new Error('Unexpected request');
    const response = Object.assign(new PassThrough(), {
      statusCode: next.status,
      headers: next.headers || {},
    });
    createdResponses.push(response);
    const respond = () => {
      onResponse(response);
      if (next.streaming) response.write(next.body ?? '');
      else response.end(next.body ?? '');
    };
    return {
      once: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      end: () => (next.delayMs ? setTimeout(respond, next.delayMs) : respond()),
    };
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(PublicPageFetchError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('fetchPublicHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdResponses.length = 0;
    lookupMock.mockResolvedValue(PUBLIC_ADDRESS);
  });

  it('returns HTML from a public page', async () => {
    respondWith({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<meta name="description" content="Public page">',
    });

    await expect(fetchPublicHtml('https://example.com/article')).resolves.toContain('Public page');
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://localhost/',
    'http://database.internal/',
    'http://example.com:5432/',
    'http://user:secret@example.com/',
  ])('rejects %s before any request is made', async (url) => {
    await expectCode(fetchPublicHtml(url), 'fetch_disallowed');
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expectCode(fetchPublicHtml('https://intranet.example.com/'), 'fetch_disallowed');
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it('rejects redirects that lead to a private address', async () => {
    respondWith({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });

    await expectCode(fetchPublicHtml('https://example.com/redirect'), 'fetch_disallowed');
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('follows redirects between public pages', async () => {
    respondWith(
      { status: 301, headers: { location: '/moved' } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Moved</title>' }
    );

    await expect(fetchPublicHtml('https://example.com/old')).resolves.toContain('Moved');
    expect(httpRequestMock).toHaveBeenCalledTimes(2);
  });

  it('rejects non-HTML responses', async () => {
    respondWith({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' });

    await expectCode(fetchPublicHtml('https://example.com/data.json'), 'unsupported_content_type');
  });

  it('keeps only the first maxBytes of a large page', async () => {
    respondWith({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Buffer.alloc(64 * 1024, 'a'),
    });

    const html = await fetchPublicHtml('https://example.com/huge', { maxBytes: 1024 });
    expect(html.length).toBeLessThanOrEqual(1024);
  });

  it('gives up when DNS does not answer within the time limit', async () => {
    lookupMock.mockReturnValue(new Promise(() => undefined));
    const startedAt = Date.now();

    await expectCode(
      fetchPublicHtml('https://slow-dns.example/', { timeoutMs: 50 }),
      'fetch_failed'
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('gives up when response headers never arrive', async () => {
    const request = { once: vi.fn().mockReturnThis(), destroy: vi.fn(), end: vi.fn() };
    httpRequestMock.mockReturnValue(request);

    await expectCode(fetchPublicHtml('https://example.com/', { timeoutMs: 50 }), 'fetch_failed');
    expect(request.destroy).toHaveBeenCalled();
  });

  it('applies one time limit across all redirects', async () => {
    const hop = { status: 302, headers: { location: '/next' }, delayMs: 40 };
    respondWith(hop, hop, hop, hop, hop);
    const startedAt = Date.now();

    await expectCode(
      fetchPublicHtml('https://example.com/start', { timeoutMs: 100 }),
      'fetch_failed'
    );
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(httpRequestMock.mock.calls.length).toBeLessThan(5);
  });

  it('closes redirect responses instead of downloading their bodies', async () => {
    respondWith(
      { status: 302, headers: { location: '/moved' }, body: 'x'.repeat(1024), streaming: true },
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Moved</title>' }
    );

    await fetchPublicHtml('https://example.com/old');
    expect(createdResponses[0].destroyed).toBe(true);
  });
});
