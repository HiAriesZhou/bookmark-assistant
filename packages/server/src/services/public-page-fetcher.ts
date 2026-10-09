import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const ROBOTS_CACHE_TTL_MS = 60 * 60_000;
const MAX_REQUESTS_PER_DOMAIN = 2;
const MIN_DOMAIN_REQUEST_INTERVAL_MS = 250;
const sharedRobotsCache = new Map<string, { expiresAt: number; policy: Promise<string | boolean> }>();
const sharedDomainLimiters = new Map<string, DomainLimiter>();

export type PublicPageFetchErrorCode =
  | 'fetch_disallowed'
  | 'unsupported_content_type'
  | 'fetch_failed';

export class PublicPageFetchError extends Error {
  constructor(public readonly code: PublicPageFetchErrorCode) {
    super(`Public page fetch failed: ${code}.`);
    this.name = 'PublicPageFetchError';
  }
}

export interface PublicPageContent {
  finalUrl: string;
  contentType: 'html' | 'plain';
  body: string;
}

export interface PublicPageDomainLimiter {
  acquire(hostname: string): Promise<() => void | Promise<void>>;
}

/**
 * Fetches only public web pages for batch AI. DNS is resolved and pinned for each
 * request, redirects are checked independently, and the raw response is never stored.
 */
export class PublicPageFetcher {
  // Shared for the lifetime of a warm server instance so consecutive browser-driven
  // batches do not reset robots policy or origin pacing on every API request.
  private readonly robotsCache = sharedRobotsCache;
  private readonly domainLimiters = sharedDomainLimiters;

  constructor(private readonly distributedDomainLimiter?: PublicPageDomainLimiter) {}

  async fetch(url: string): Promise<PublicPageContent> {
    return this.fetchFollowingRedirects(url, 0);
  }

  private async fetchFollowingRedirects(rawUrl: string, redirectCount: number): Promise<PublicPageContent> {
    if (redirectCount > MAX_REDIRECTS) throw new PublicPageFetchError('fetch_disallowed');
    const url = await resolvePublicUrl(rawUrl);
    if (!(await this.isAllowedByRobots(url))) throw new PublicPageFetchError('fetch_disallowed');
    const response = await this.requestWithDomainLimit(url);
    const statusCode = response.statusCode || 0;

    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = response.headers.location;
      discardResponse(response);
      if (!location) throw new PublicPageFetchError('fetch_failed');
      return this.fetchFollowingRedirects(new URL(location, url).toString(), redirectCount + 1);
    }
    if (statusCode < 200 || statusCode >= 300) {
      discardResponse(response);
      throw new PublicPageFetchError('fetch_failed');
    }

    const contentType = response.headers['content-type']?.toLowerCase() || '';
    const kind = contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
      ? 'html'
      : contentType.startsWith('text/plain')
        ? 'plain'
        : undefined;
    if (!kind) {
      discardResponse(response);
      throw new PublicPageFetchError('unsupported_content_type');
    }

    const rawBody = await readLimitedResponse(response);
    return { finalUrl: url.toString(), contentType: kind, body: extractReadableText(rawBody, kind) };
  }

  private async isAllowedByRobots(url: URL): Promise<boolean> {
    const origin = url.origin;
    const cached = this.robotsCache.get(origin);
    const policy = cached && cached.expiresAt > Date.now()
      ? cached.policy
      : this.fetchRobotsPolicy(url);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.robotsCache.set(origin, { expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS, policy });
    }
    const resolved = await policy;
    return typeof resolved === 'string'
      ? isPathAllowedByRobots(resolved, `${url.pathname}${url.search}`)
      : resolved;
  }

  private async fetchRobotsPolicy(url: URL): Promise<string | boolean> {
    try {
      const robotsUrl = await resolvePublicUrl(new URL('/robots.txt', url.origin).toString());
      const response = await this.requestWithDomainLimit(robotsUrl, 'text/plain,*/*;q=0.1');
      const status = response.statusCode || 0;
      if (status === 404 || status === 410) { discardResponse(response); return true; }
      if (status === 401 || status === 403) { discardResponse(response); return false; }
      if (status < 200 || status >= 300) { discardResponse(response); return false; }
      return readLimitedResponse(response);
    } catch {
      return false;
    }
  }

  private async requestWithDomainLimit(url: URL, accept?: string): Promise<import('http').IncomingMessage> {
    const limiter = this.domainLimiters.get(url.hostname) ||
      new DomainLimiter(MAX_REQUESTS_PER_DOMAIN, MIN_DOMAIN_REQUEST_INTERVAL_MS);
    this.domainLimiters.set(url.hostname, limiter);
    const release = this.distributedDomainLimiter
      ? await this.distributedDomainLimiter.acquire(url.hostname)
      : await limiter.acquire();
    try {
      const response = await requestPinnedUrl(url, accept);
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        void Promise.resolve(release()).catch(() => undefined);
      };
      response.once('end', releaseOnce);
      response.once('close', releaseOnce);
      response.once('error', releaseOnce);
      return response;
    } catch (error) {
      await Promise.resolve(release()).catch(() => undefined);
      throw error;
    }
  }
}

export interface PublicHtmlFetchOptions {
  /** Bytes kept from the response; the rest of the page is not downloaded. */
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Fetches raw HTML from a public page with the same address, port and redirect
 * checks as PublicPageFetcher, without robots or pacing. Used for metadata such as
 * descriptions, which only need the beginning of the document.
 */
export async function fetchPublicHtml(
  rawUrl: string,
  { maxBytes = MAX_RESPONSE_BYTES, timeoutMs = FETCH_TIMEOUT_MS }: PublicHtmlFetchOptions = {}
): Promise<string> {
  let current = rawUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const url = await resolvePublicUrl(current);
    const response = await requestPinnedUrl(
      url,
      'text/html,application/xhtml+xml;q=0.9',
      timeoutMs
    );
    const statusCode = response.statusCode || 0;

    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = response.headers.location;
      discardResponse(response);
      if (!location) throw new PublicPageFetchError('fetch_failed');
      current = new URL(location, url).toString();
      continue;
    }
    if (statusCode < 200 || statusCode >= 300) {
      discardResponse(response);
      throw new PublicPageFetchError('fetch_failed');
    }
    const contentType = response.headers['content-type']?.toLowerCase() || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      discardResponse(response);
      throw new PublicPageFetchError('unsupported_content_type');
    }
    return readLimitedResponse(response, { maxBytes, timeoutMs, truncate: true });
  }
  throw new PublicPageFetchError('fetch_disallowed');
}

/** Applies the longest matching rule for BookmarkAssistantBot, falling back to *. */
export function isPathAllowedByRobots(robots: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let group: (typeof groups)[number] | undefined;
  let sawRule = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) { group = undefined; sawRule = false; continue; }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!group || sawRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        sawRule = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (field === 'allow' || field === 'disallow')) {
      sawRule = true;
      if (value) group.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const specific = groups.filter((candidate) => candidate.agents.includes('bookmarkassistantbot'));
  const applicable = specific.length ? specific : groups.filter((candidate) => candidate.agents.includes('*'));
  const matches = applicable
    .flatMap((candidate) => candidate.rules)
    .map((rule) => ({ ...rule, matchLength: matchRobotsPath(rule.path, path) }))
    .filter((rule): rule is typeof rule & { matchLength: number } => rule.matchLength !== undefined);
  if (!matches.length) return true;
  matches.sort((a, b) => b.matchLength - a.matchLength || Number(b.allow) - Number(a.allow));
  return matches[0].allow;
}

function matchRobotsPath(pattern: string, path: string): number | undefined {
  const endAnchored = pattern.endsWith('$');
  const normalizedPattern = endAnchored ? pattern.slice(0, -1) : pattern;
  const expression = normalizedPattern
    .split('*')
    .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('.*');
  const matches = new RegExp(`^${expression}${endAnchored ? '$' : ''}`).test(path);
  return matches ? normalizedPattern.replace(/\*/g, '').length : undefined;
}

export class DomainLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private schedule = Promise.resolve();
  private nextStartAt = 0;

  constructor(
    private readonly limit: number,
    private readonly minimumIntervalMs: number
  ) {}

  async acquire(): Promise<() => void> {
    let releaseSchedule!: () => void;
    const previousSchedule = this.schedule;
    this.schedule = new Promise<void>((resolve) => { releaseSchedule = resolve; });
    await previousSchedule;
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    const pacingDelay = Math.max(0, this.nextStartAt - Date.now());
    if (pacingDelay) await new Promise((resolve) => setTimeout(resolve, pacingDelay));
    this.active += 1;
    this.nextStartAt = Date.now() + this.minimumIntervalMs;
    releaseSchedule();
    return () => {
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }
}

export async function resolvePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicPageFetchError('fetch_disallowed');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new PublicPageFetchError('fetch_disallowed');
  }
  if (isBlockedHostname(url.hostname)) throw new PublicPageFetchError('fetch_disallowed');

  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address.address))) {
    throw new PublicPageFetchError('fetch_disallowed');
  }
  return url;
}

export function extractReadableText(rawBody: string, contentType: 'html' | 'plain'): string {
  if (contentType === 'plain') return normalizeText(rawBody);
  const likelyContent =
    rawBody.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    rawBody.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    rawBody.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ||
    rawBody;
  return normalizeText(
    likelyContent
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function isBlockedHostname(hostname: string): boolean {
  // URL.hostname keeps the brackets around IPv6 literals, e.g. "[::1]".
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[(.*)\]$/, '$1');
  return (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.test') ||
    host === 'metadata.google.internal' ||
    isPrivateAddress(host)
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const [first, second] = normalized.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }
  if (isIP(normalized) === 6) {
    const mappedIpv4 = ipv4FromMappedIpv6(normalized);
    if (mappedIpv4) return isPrivateAddress(mappedIpv4);
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

/** Returns the IPv4 address embedded in a valid IPv4-mapped IPv6 literal. */
function ipv4FromMappedIpv6(address: string): string | undefined {
  const dotted = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];

  const hexadecimal = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexadecimal) return undefined;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

async function requestPinnedUrl(
  url: URL,
  accept = 'text/html,application/xhtml+xml,text/plain;q=0.9',
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<import('http').IncomingMessage> {
  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
  const selected = resolved.find((address) => !isPrivateAddress(address.address));
  if (!selected || resolved.some((address) => isPrivateAddress(address.address))) {
    throw new PublicPageFetchError('fetch_disallowed');
  }
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        accept,
        'user-agent': 'BookmarkAssistantBot/1.0 (+https://bookmarkassistant.com)',
      },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      timeout: timeoutMs,
    }, resolve);
    req.once('timeout', () => req.destroy(new Error('timeout')));
    req.once('error', () => reject(new PublicPageFetchError('fetch_failed')));
    req.end();
  });
}

function discardResponse(response: import('http').IncomingMessage): void {
  response.resume();
}

function readLimitedResponse(
  response: import('http').IncomingMessage,
  {
    maxBytes = MAX_RESPONSE_BYTES,
    timeoutMs = FETCH_TIMEOUT_MS,
    truncate = false,
  }: { maxBytes?: number; timeoutMs?: number; truncate?: boolean } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(new PublicPageFetchError('fetch_failed'));
    }, timeoutMs);
    const finish = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    response.on('data', (chunk: Buffer) => {
      if (length + chunk.length > maxBytes) {
        response.destroy();
        if (!truncate) {
          finish(reject, new PublicPageFetchError('fetch_failed'));
          return;
        }
        chunks.push(chunk.subarray(0, maxBytes - length));
        finish(resolve, Buffer.concat(chunks).toString('utf8'));
        return;
      }
      length += chunk.length;
      chunks.push(chunk);
    });
    response.once('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
    response.once('error', () => finish(reject, new PublicPageFetchError('fetch_failed')));
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
