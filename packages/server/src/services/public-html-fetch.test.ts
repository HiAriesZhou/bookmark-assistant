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

type FakeResponse = { status: number; headers?: Record<string, string>; body?: string | Buffer };

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
    const request = {
      once: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      end: () => {
        onResponse(response);
        response.end(next.body ?? '');
      },
    };
    return request;
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(PublicPageFetchError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('fetchPublicHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
