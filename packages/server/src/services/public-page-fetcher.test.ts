import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DomainLimiter,
  extractReadableText,
  isPathAllowedByRobots,
  isPrivateAddress,
  resolvePublicUrl,
} from './public-page-fetcher';

afterEach(() => vi.useRealTimers());

describe('PublicPageFetcher policy helpers', () => {
  it.each([
    'file:///etc/passwd',
    'http://user:password@example.com/',
    'http://localhost/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://example.com:8080/',
  ])('rejects disallowed targets: %s', async (url) => {
    await expect(resolvePublicUrl(url)).rejects.toMatchObject({ code: 'fetch_disallowed' });
  });

  it('extracts primary HTML content while removing executable and navigation elements', () => {
    expect(
      extractReadableText(
        '<html><body><nav>Ignore nav</nav><article><h1>Useful title</h1><script>ignore()</script><p>Useful &amp; safe text.</p></article><footer>Ignore footer</footer></body></html>',
        'html'
      )
    ).toBe('Useful title Useful & safe text.');
  });

  it('normalizes plain text without attempting HTML parsing', () => {
    expect(extractReadableText(' first\n\nsecond ', 'plain')).toBe('first second');
  });

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
  ])('blocks private IPv4-mapped IPv6 addresses: %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it('prefers BookmarkAssistantBot robots rules and applies the longest matching path', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: BookmarkAssistantBot',
      'Disallow: /private',
      'Allow: /private/public',
    ].join('\n');
    expect(isPathAllowedByRobots(robots, '/article')).toBe(true);
    expect(isPathAllowedByRobots(robots, '/private/item')).toBe(false);
    expect(isPathAllowedByRobots(robots, '/private/public/item')).toBe(true);
  });

  it('falls back to wildcard robots rules', () => {
    expect(isPathAllowedByRobots('User-agent: *\nDisallow: /admin', '/admin/settings')).toBe(false);
    expect(isPathAllowedByRobots('User-agent: *\nDisallow: /admin', '/post')).toBe(true);
  });

  it('honors robots wildcards and end anchors used by public sites', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /*?token=',
      'Disallow: /*.pdf$',
      'Allow: /public/*.pdf$',
    ].join('\n');
    expect(isPathAllowedByRobots(robots, '/article?token=secret')).toBe(false);
    expect(isPathAllowedByRobots(robots, '/private/report.pdf')).toBe(false);
    expect(isPathAllowedByRobots(robots, '/public/report.pdf')).toBe(true);
    expect(isPathAllowedByRobots(robots, '/private/report.pdf?download=1')).toBe(true);
  });

  it('paces consecutive requests to the same domain', async () => {
    vi.useFakeTimers();
    const limiter = new DomainLimiter(2, 250);
    const releaseFirst = await limiter.acquire();
    let secondStarted = false;
    const second = limiter.acquire().then((release) => {
      secondStarted = true;
      return release;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(secondStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const releaseSecond = await second;
    expect(secondStarted).toBe(true);
    releaseFirst();
    releaseSecond();
  });
});
