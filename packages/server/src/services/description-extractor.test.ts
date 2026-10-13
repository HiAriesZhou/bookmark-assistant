/**
 * Unit tests for DescriptionExtractor service
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchPublicHtmlMock } = vi.hoisted(() => ({ fetchPublicHtmlMock: vi.fn() }));

vi.mock('./description-cache', () => ({
  descriptionCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./public-page-fetcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./public-page-fetcher')>()),
  fetchPublicHtml: fetchPublicHtmlMock,
}));

import { DescriptionExtractor } from './description-extractor';
import { PublicPageFetchError } from './public-page-fetcher';
import { descriptionCache } from './description-cache';
import {
  extractDescriptionFromHtml,
  isValidDescription,
  looksLikeDescription,
  sanitizeDescription,
} from '../core/descriptions';

describe('DescriptionExtractor', () => {
  let extractor: DescriptionExtractor;

  beforeEach(() => {
    extractor = new DescriptionExtractor();
    vi.clearAllMocks();
  });

  describe('extractFromUrl', () => {
    it('uses cached descriptions under the normalized URL without fetching', async () => {
      vi.mocked(descriptionCache.get).mockResolvedValueOnce({
        description: 'Cached description',
        source: 'meta_description',
        url: 'https://example.com/page?a=1&b=2',
        createdAt: new Date(0),
        hits: 1,
        fromCache: true,
      });
      expect(await extractor.extractFromUrl('https://example.com/page/?b=2&a=1#fragment')).toEqual({
        description: 'Cached description',
        source: 'meta_description',
        success: true,
        url: 'https://example.com/page?a=1&b=2',
        fromCache: true,
      });
      expect(descriptionCache.get).toHaveBeenCalledWith('https://example.com/page?a=1&b=2');
      expect(fetchPublicHtmlMock).not.toHaveBeenCalled();
    });
    it('should extract description from valid HTTP URL', async () => {
      fetchPublicHtmlMock.mockResolvedValue(`
        <html>
          <head>
            <meta name="description" content="Test description content" />
          </head>
        </html>
      `);

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(true);
      expect(result.description).toBe('Test description content');
      expect(result.source).toBe('meta_description');
      expect(descriptionCache.set).toHaveBeenCalledWith(
        'https://example.com/',
        'Test description content',
        'meta_description'
      );
      expect(fetchPublicHtmlMock).toHaveBeenCalledWith('https://example.com/', {
        maxBytes: 512 * 1024,
        timeoutMs: 5000,
      });
    });

    it('should return error for invalid URL', async () => {
      const result = await extractor.extractFromUrl('not-a-valid-url');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid URL');
      expect(result.description).toBe('');
    });

    it('should return error for non-HTTP URLs', async () => {
      const result = await extractor.extractFromUrl('file:///local/file.html');

      expect(result.success).toBe(false);
      expect(result.error).toBe('URL is not fetchable');
      expect(fetchPublicHtmlMock).not.toHaveBeenCalled();
    });

    it('should not fetch private or internal addresses', async () => {
      fetchPublicHtmlMock.mockRejectedValue(new PublicPageFetchError('fetch_disallowed'));

      const result = await extractor.extractFromUrl('http://169.254.169.254/latest/meta-data/');

      expect(result.success).toBe(false);
      expect(result.error).toBe('fetch_disallowed');
      expect(result.description).toBe('');
    });

    it('should handle fetch failures gracefully', async () => {
      fetchPublicHtmlMock.mockRejectedValue(new Error('Network error'));

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('fetch_failed');
      expect(result.description).toBe('');
    });

    it('should return error for non-HTML content', async () => {
      fetchPublicHtmlMock.mockRejectedValue(new PublicPageFetchError('unsupported_content_type'));

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('unsupported_content_type');
    });
  });
});

const descriptiveTitle = 'How to build a REST API in Node.js - A comprehensive guide';
const descriptiveMeta =
  'Learn how to build modern web applications with React and TypeScript. A comprehensive guide for developers.';
const content = 'This is the main content of the page with substantial information.';
const longContent = 'A'.repeat(300);
const empty = { text: '', source: 'empty' };

describe('HTML description selection', () => {
  it.each([
    [
      'meta before OG',
      '<meta name="description" content="Meta description"><meta property="og:description" content="OG description">',
      'Meta description',
      'meta_description',
    ],
    [
      'OG fallback',
      '<meta property="og:description" content="OG description">',
      'OG description',
      'og_description',
    ],
    [
      'valid meta',
      `<meta name="description" content="${descriptiveMeta}">`,
      descriptiveMeta,
      'meta_description',
    ],
    ...['main', 'article', 'section'].map((tag) => [
      tag,
      `<${tag}><p>${content}</p></${tag}>`,
      content,
      'content',
    ]),
    ['nested section', `<main><section><p>${content}</p></section></main>`, content, 'content'],
    [
      'structured truncation',
      `<main><p>${longContent}</p></main>`,
      'A'.repeat(200) + '...',
      'content',
    ],
    ['descriptive title', `<title>${descriptiveTitle}</title>`, descriptiveTitle, 'title'],
    [
      'question title',
      '<title>What is Docker and how does it work? An introduction to containerization</title>',
      'What is Docker and how does it work? An introduction to containerization',
      'title',
    ],
    [
      'learning title',
      '<title>Learn the best practices for React development in 2024</title>',
      'Learn the best practices for React development in 2024',
      'title',
    ],
    [
      'body first paragraph',
      `<body><p>${content}</p><p>Another paragraph.</p></body>`,
      content,
      'content',
    ],
    ['body truncation', `<body><p>${longContent}</p></body>`, 'A'.repeat(200) + '...', 'content'],
  ])('%s', (_name, html, text, source) => {
    expect(extractDescriptionFromHtml(html)).toEqual({ text, source });
  });

  it.each([
    '<meta name="description" content="">',
    '<meta name="description" content="Home - ACME Corp">',
    '<meta name="description" content="ACME CORPORATION">',
    '<main><p>Too short</p></main>',
    '<body><p>Too short</p></body>',
    ...['Home - ACME Corp', 'Login - MySite', 'Untitled Document', 'Short', 'A'.repeat(250)].map(
      (title) => `<title>${title}</title>`
    ),
    '<title>No Description</title><body><p></p></body>',
  ])('rejects %s', (html) => {
    expect(extractDescriptionFromHtml(html)).toEqual(empty);
  });
});

describe('description validation', () => {
  it.each([
    ['Learn how to build modern web applications', true] as const,
    ['This comprehensive guide covers everything', true] as const,
    ...[
      'Short',
      'A',
      'A'.repeat(501),
      'Home - Brand',
      'Brand | Name',
      'Brand: Name',
      'ACME CORPORATION',
      'COMPANY NAME',
      'Home',
      'Login',
      '',
    ].map((text) => [text, false] as const),
  ])('%s is valid: %s', (text, valid) => {
    expect(isValidDescription(text)).toBe(valid);
  });

  it.each([
    ...[
      'How to build a REST API in Node.js',
      'Learn the best practices for React development',
      'What is Docker and how does it work?',
      'How to build modern apps',
      'What is React and why use it',
      'Learn best practices',
      'Top 10 JavaScript frameworks',
      'This is a comprehensive guide. Learn everything.',
      'What is Docker? An introduction.',
      'How to build modern web applications',
    ].map((text) => [text, true] as const),
    ...[
      'Home - ACME Corp',
      'Brand | Page',
      'Brand :: Page',
      'Login',
      'Sign up',
      'Register',
      'Contact',
      'Home',
      '404',
      'Error',
      'Page Not Found',
      'Short',
      'A'.repeat(201),
      'One Two',
      'Single Word',
    ].map((text) => [text, false] as const),
  ])('%s looks descriptive: %s', (text, valid) => {
    expect(looksLikeDescription(text)).toBe(valid);
  });

  it.each([
    ['<p>Text content</p>', 'Text content'],
    ['Text &amp; content &lt;tag&gt;', 'Text content tag'],
    ['  Text   with    spaces  ', 'Text with spaces'],
    ['  trimmed  ', 'trimmed'],
    ['A'.repeat(600), 'A'.repeat(500)],
  ])('sanitizes %s', (text, expected) => {
    expect(sanitizeDescription(text)).toBe(expected);
  });
});
