/**
 * Unit tests for DescriptionExtractor service
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./description-cache', () => ({
  descriptionCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DescriptionExtractor } from './description-extractor';

describe('DescriptionExtractor', () => {
  let extractor: DescriptionExtractor;

  beforeEach(() => {
    extractor = new DescriptionExtractor();
    vi.clearAllMocks();
  });

  describe('extractFromUrl', () => {
    it('should extract description from valid HTTP URL', async () => {
      const mockHtml = `
        <html>
          <head>
            <meta name="description" content="Test description content" />
          </head>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: () => Promise.resolve(mockHtml),
      });

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(true);
      expect(result.description).toBe('Test description content');
      expect(result.source).toBe('meta_description');
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
    });

    it('should handle fetch failures gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.description).toBe('');
    });

    it('should handle timeout', async () => {
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 100);
          })
      );

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.description).toBe('');
    });

    it('should return error for non-HTML content', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: () => Promise.resolve('{"error": "not html"}'),
      });

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Non-HTML');
    });

    it('should return error for HTTP errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await extractor.extractFromUrl('https://example.com');

      expect(result.success).toBe(false);
      expect(result.description).toBe('');
    });
  });

  describe('extractDescription - meta description priority', () => {
    it('should extract from meta name="description" first', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="Meta description" />
            <meta property="og:description" content="OG description" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('Meta description');
      expect(result.source).toBe('meta_description');
    });

    it('should fall back to og:description if meta description not found', () => {
      const html = `
        <html>
          <head>
            <meta property="og:description" content="OG description" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('OG description');
      expect(result.source).toBe('og_description');
    });

    it('should prefer meta description over og:description', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="First description" />
            <meta property="og:description" content="Second description" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('First description');
      expect(result.source).toBe('meta_description');
    });
  });

  describe('extractDescription - validation', () => {
    it('should reject empty meta description', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should reject meta description that looks like a title', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="Home - ACME Corp" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should reject all-caps meta description', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="ACME CORPORATION" />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should accept valid meta description', () => {
      const html = `
        <html>
          <head>
            <meta name="description" content="Learn how to build modern web applications with React and TypeScript. A comprehensive guide for developers." />
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe(
        'Learn how to build modern web applications with React and TypeScript. A comprehensive guide for developers.'
      );
      expect(result.source).toBe('meta_description');
    });
  });

  describe('extractDescription - structured content', () => {
    it('should extract from main/article sections', () => {
      const html = `
        <html>
          <body>
            <main>
              <p>This is the main content of the page with substantial information.</p>
            </main>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe(
        'This is the main content of the page with substantial information.'
      );
      expect(result.source).toBe('content');
    });

    it('should extract from article section', () => {
      const html = `
        <html>
          <body>
            <article>
              <p>Article content describing the main topic of this page.</p>
            </article>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('Article content describing the main topic of this page.');
      expect(result.source).toBe('content');
    });

    it('should extract from section within main', () => {
      const html = `
        <html>
          <body>
            <main>
              <section>
                <p>Section content within main tag providing page description.</p>
              </section>
            </main>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('Section content within main tag providing page description.');
      expect(result.source).toBe('content');
    });

    it('should reject short content from structured elements', () => {
      const html = `
        <html>
          <body>
            <main>
              <p>Too short</p>
            </main>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should truncate long content to 200 chars', () => {
      const longContent = 'A'.repeat(300);
      const html = `
        <html>
          <body>
            <main>
              <p>${longContent}</p>
            </main>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text.length).toBe(203); // 200 + '...'
      expect(result.text.endsWith('...')).toBe(true);
      expect(result.source).toBe('content');
    });
  });

  describe('extractDescription - title fallback', () => {
    it('should use title if it looks like a description', () => {
      const html = `
        <html>
          <head>
            <title>How to build a REST API in Node.js - A comprehensive guide</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('How to build a REST API in Node.js - A comprehensive guide');
      expect(result.source).toBe('title');
    });

    it('should reject title with brand pattern', () => {
      const html = `
        <html>
          <head>
            <title>Home - ACME Corp</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should reject navigation titles', () => {
      const html = `
        <html>
          <head>
            <title>Login - MySite</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should reject generic titles', () => {
      const html = `
        <html>
          <head>
            <title>Untitled Document</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should accept title with descriptive indicators', () => {
      const html = `
        <html>
          <head>
            <title>What is Docker and how does it work? An introduction to containerization</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe(
        'What is Docker and how does it work? An introduction to containerization'
      );
      expect(result.source).toBe('title');
    });

    it('should accept title with question words', () => {
      const html = `
        <html>
          <head>
            <title>Learn the best practices for React development in 2024</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('Learn the best practices for React development in 2024');
      expect(result.source).toBe('title');
    });

    it('should reject title that is too short', () => {
      const html = `
        <html>
          <head>
            <title>Short</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should reject title that is too long', () => {
      const longTitle = 'A'.repeat(250);
      const html = `
        <html>
          <head>
            <title>${longTitle}</title>
          </head>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });
  });

  describe('extractDescription - body paragraph fallback', () => {
    it('should extract first paragraph from body', () => {
      const html = `
        <html>
          <body>
            <p>This is the first paragraph with substantial content describing the page.</p>
            <p>This is the second paragraph.</p>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe(
        'This is the first paragraph with substantial content describing the page.'
      );
      expect(result.source).toBe('content');
    });

    it('should reject short paragraph from body', () => {
      const html = `
        <html>
          <body>
            <p>Too short</p>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });

    it('should truncate long body paragraph', () => {
      const longContent = 'A'.repeat(300);
      const html = `
        <html>
          <body>
            <p>${longContent}</p>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text.length).toBe(203);
      expect(result.text.endsWith('...')).toBe(true);
    });
  });

  describe('extractDescription - empty fallback', () => {
    it('should return empty if no description found', () => {
      const html = `
        <html>
          <head>
            <title>No Description</title>
          </head>
          <body>
            <p></p>
          </body>
        </html>
      `;

      const result = extractor['extractDescription'](html);

      expect(result.text).toBe('');
      expect(result.source).toBe('empty');
    });
  });

  describe('normalizeUrl', () => {
    it('should remove trailing slash from pathname', () => {
      const result = extractor.normalizeUrl('https://example.com/page/');

      expect(result).toBe('https://example.com/page');
    });

    it('should preserve root path trailing slash', () => {
      const result = extractor.normalizeUrl('https://example.com/');

      expect(result).toBe('https://example.com/');
    });

    it('should remove fragments', () => {
      const result = extractor.normalizeUrl('https://example.com/page#section');

      expect(result).toBe('https://example.com/page');
    });

    it('should sort query parameters', () => {
      const result1 = extractor.normalizeUrl('https://example.com/page?b=2&a=1');
      const result2 = extractor.normalizeUrl('https://example.com/page?a=1&b=2');

      expect(result1).toBe(result2);
      expect(result1).toBe('https://example.com/page?a=1&b=2');
    });

    it('should handle URLs without query parameters', () => {
      const result = extractor.normalizeUrl('https://example.com/page');

      expect(result).toBe('https://example.com/page');
    });

    it('should normalize complex URLs', () => {
      const result = extractor.normalizeUrl('https://example.com/path/?b=2&a=1#fragment');

      expect(result).toBe('https://example.com/path?a=1&b=2');
    });

    it('should handle URLs with ports', () => {
      const result = extractor.normalizeUrl('https://example.com:8080/page/');

      expect(result).toBe('https://example.com:8080/page');
    });

    it('should handle http URLs', () => {
      const result = extractor.normalizeUrl('http://example.com/page/');

      expect(result).toBe('http://example.com/page');
    });

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = extractor.normalizeUrl(invalidUrl);

      expect(result).toBe(invalidUrl);
    });
  });

  describe('isValidDescription', () => {
    it('should accept valid descriptions', () => {
      expect(extractor['isValidDescription']('Learn how to build modern web applications')).toBe(
        true
      );
      expect(extractor['isValidDescription']('This comprehensive guide covers everything')).toBe(
        true
      );
    });

    it('should reject descriptions that are too short', () => {
      expect(extractor['isValidDescription']('Short')).toBe(false);
      expect(extractor['isValidDescription']('A')).toBe(false);
    });

    it('should reject descriptions that are too long', () => {
      expect(extractor['isValidDescription']('A'.repeat(501))).toBe(false);
    });

    it('should reject brand patterns with separators', () => {
      expect(extractor['isValidDescription']('Home - Brand')).toBe(false);
      expect(extractor['isValidDescription']('Brand | Name')).toBe(false);
      expect(extractor['isValidDescription']('Brand: Name')).toBe(false);
    });

    it('should reject all-caps descriptions', () => {
      expect(extractor['isValidDescription']('ACME CORPORATION')).toBe(false);
      expect(extractor['isValidDescription']('COMPANY NAME')).toBe(false);
    });

    it('should reject single words', () => {
      expect(extractor['isValidDescription']('Home')).toBe(false);
      expect(extractor['isValidDescription']('Login')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(extractor['isValidDescription']('')).toBe(false);
    });
  });

  describe('looksLikeDescription', () => {
    it('should accept descriptive titles', () => {
      expect(extractor['looksLikeDescription']('How to build a REST API in Node.js')).toBe(true);
      expect(
        extractor['looksLikeDescription']('Learn the best practices for React development')
      ).toBe(true);
      expect(extractor['looksLikeDescription']('What is Docker and how does it work?')).toBe(true);
    });

    it('should reject brand patterns', () => {
      expect(extractor['looksLikeDescription']('Home - ACME Corp')).toBe(false);
      expect(extractor['looksLikeDescription']('Brand | Page')).toBe(false);
      expect(extractor['looksLikeDescription']('Brand :: Page')).toBe(false);
    });

    it('should reject navigation words', () => {
      expect(extractor['looksLikeDescription']('Login')).toBe(false);
      expect(extractor['looksLikeDescription']('Sign up')).toBe(false);
      expect(extractor['looksLikeDescription']('Register')).toBe(false);
      expect(extractor['looksLikeDescription']('Contact')).toBe(false);
    });

    it('should reject generic titles', () => {
      expect(extractor['looksLikeDescription']('Home')).toBe(false);
      expect(extractor['looksLikeDescription']('404')).toBe(false);
      expect(extractor['looksLikeDescription']('Error')).toBe(false);
      expect(extractor['looksLikeDescription']('Page Not Found')).toBe(false);
    });

    it('should accept titles with descriptive indicators', () => {
      expect(extractor['looksLikeDescription']('How to build modern apps')).toBe(true);
      expect(extractor['looksLikeDescription']('What is React and why use it')).toBe(true);
      expect(extractor['looksLikeDescription']('Learn best practices')).toBe(true);
      expect(extractor['looksLikeDescription']('Top 10 JavaScript frameworks')).toBe(true);
    });

    it('should accept titles with punctuation', () => {
      expect(
        extractor['looksLikeDescription']('This is a comprehensive guide. Learn everything.')
      ).toBe(true);
      expect(extractor['looksLikeDescription']('What is Docker? An introduction.')).toBe(true);
    });

    it('should reject titles that are too short', () => {
      expect(extractor['looksLikeDescription']('Short')).toBe(false);
      expect(extractor['looksLikeDescription']('Home')).toBe(false);
    });

    it('should reject titles that are too long', () => {
      expect(extractor['looksLikeDescription']('A'.repeat(201))).toBe(false);
    });

    it('should reject titles with too few words', () => {
      expect(extractor['looksLikeDescription']('One Two')).toBe(false);
      expect(extractor['looksLikeDescription']('Single Word')).toBe(false);
    });

    it('should accept titles with sufficient words', () => {
      expect(extractor['looksLikeDescription']('How to build modern web applications')).toBe(true);
    });
  });

  describe('sanitizeDescription', () => {
    it('should remove HTML tags', () => {
      const result = extractor['sanitizeDescription']('<p>Text content</p>');

      expect(result).toBe('Text content');
    });

    it('should replace HTML entities with spaces', () => {
      const result = extractor['sanitizeDescription']('Text &amp; content &lt;tag&gt;');

      expect(result).toBe('Text content tag');
    });

    it('should normalize whitespace', () => {
      const result = extractor['sanitizeDescription']('  Text   with    spaces  ');

      expect(result).toBe('Text with spaces');
    });

    it('should trim text', () => {
      const result = extractor['sanitizeDescription']('  trimmed  ');

      expect(result).toBe('trimmed');
    });

    it('should limit length to 500 characters', () => {
      const longText = 'A'.repeat(600);
      const result = extractor['sanitizeDescription'](longText);

      expect(result.length).toBe(500);
    });
  });
});
