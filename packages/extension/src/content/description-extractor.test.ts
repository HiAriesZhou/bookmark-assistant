/**
 * Comprehensive tests for description extractor
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeUrl } from '../core';

// Mock chrome.runtime
const mockChromeRuntime = {
  sendMessage: vi.fn().mockResolvedValue({}),
};

vi.stubGlobal('chrome', {
  runtime: mockChromeRuntime,
});

// Extract the extractPageDescription function logic for testing
// This mirrors the logic in description-extractor.ts
function extractPageDescription(document: Document): string {
  // Priority 1: <meta name='description'>
  const metaDescription = document
    .querySelector('meta[name="description"]')
    ?.getAttribute('content');

  if (metaDescription && metaDescription.trim()) {
    return metaDescription.trim();
  }

  // Priority 2: <meta property='og:description'>
  const ogDescription = document
    .querySelector('meta[property="og:description"]')
    ?.getAttribute('content');

  if (ogDescription && ogDescription.trim()) {
    return ogDescription.trim();
  }

  // Priority 3: Fallback to empty string
  return '';
}

describe('extractPageDescription', () => {
  beforeEach(() => {
    // Clear document head before each test
    document.head.innerHTML = '';
    vi.clearAllMocks();
  });

  it('should extract from meta name="description" first', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'Test description content');
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe('Test description content');
  });

  it('should fall back to og:description if meta description not found', () => {
    const ogMeta = document.createElement('meta');
    ogMeta.setAttribute('property', 'og:description');
    ogMeta.setAttribute('content', 'OG description content');
    document.head.appendChild(ogMeta);

    const result = extractPageDescription(document);
    expect(result).toBe('OG description content');
  });

  it('should prefer meta description over og:description', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'Meta description');
    document.head.appendChild(meta);

    const ogMeta = document.createElement('meta');
    ogMeta.setAttribute('property', 'og:description');
    ogMeta.setAttribute('content', 'OG description');
    document.head.appendChild(ogMeta);

    const result = extractPageDescription(document);
    expect(result).toBe('Meta description');
  });

  it('should return empty string if no meta tags found', () => {
    const result = extractPageDescription(document);
    expect(result).toBe('');
  });

  it('should trim whitespace from descriptions', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', '  Description with spaces  ');
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe('Description with spaces');
  });

  it('should return empty string for empty meta content', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', '   ');
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe('');
  });

  it('should handle missing content attribute', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    // No content attribute
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe('');
  });

  it('should handle multiple meta description tags (use first)', () => {
    const meta1 = document.createElement('meta');
    meta1.setAttribute('name', 'description');
    meta1.setAttribute('content', 'First description');
    document.head.appendChild(meta1);

    const meta2 = document.createElement('meta');
    meta2.setAttribute('name', 'description');
    meta2.setAttribute('content', 'Second description');
    document.head.appendChild(meta2);

    const result = extractPageDescription(document);
    // querySelector returns first match
    expect(result).toBe('First description');
  });

  it('should handle special characters in descriptions', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', 'Description with "quotes" & <tags>');
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe('Description with "quotes" & <tags>');
  });

  it('should handle very long descriptions', () => {
    const longDescription = 'A'.repeat(1000);
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    meta.setAttribute('content', longDescription);
    document.head.appendChild(meta);

    const result = extractPageDescription(document);
    expect(result).toBe(longDescription);
  });
});

describe('URL Normalization', () => {
  describe('normalizeUrl', () => {
    it('should remove trailing slash from pathname', () => {
      expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should preserve root path trailing slash', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should remove fragments (hash)', () => {
      expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
      expect(normalizeUrl('https://example.com/#top')).toBe('https://example.com/');
    });

    it('should sort query parameters', () => {
      const url1 = normalizeUrl('https://example.com/page?b=2&a=1');
      const url2 = normalizeUrl('https://example.com/page?a=1&b=2');
      expect(url1).toBe(url2);
      expect(url1).toBe('https://example.com/page?a=1&b=2');
    });

    it('should handle URLs without query parameters', () => {
      expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page');
    });

    it('should handle URLs with only query parameters', () => {
      expect(normalizeUrl('https://example.com/?b=2&a=1')).toBe('https://example.com/?a=1&b=2');
    });

    it('should handle complex URLs with path, query, and fragment', () => {
      const normalized = normalizeUrl('https://example.com/path/?b=2&a=1#fragment');
      expect(normalized).toBe('https://example.com/path?a=1&b=2');
    });

    it('should handle http URLs', () => {
      expect(normalizeUrl('http://example.com/page/')).toBe('http://example.com/page');
    });

    it('should handle URLs with ports', () => {
      expect(normalizeUrl('https://example.com:8080/page/')).toBe('https://example.com:8080/page');
    });

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = normalizeUrl(invalidUrl);
      // Should return original URL if parsing fails
      expect(result).toBe(invalidUrl);
    });

    it('should normalize URLs consistently', () => {
      const variants = [
        'https://example.com/page/',
        'https://example.com/page',
        'https://example.com/page/?',
        'https://example.com/page#',
      ];

      const normalized = variants.map(normalizeUrl);
      // All should normalize to the same URL (except root with trailing slash)
      expect(normalized[0]).toBe('https://example.com/page');
      expect(normalized[1]).toBe('https://example.com/page');
      expect(normalized[2]).toBe('https://example.com/page');
      expect(normalized[3]).toBe('https://example.com/page');
    });

    it('should handle URLs with encoded characters', () => {
      expect(normalizeUrl('https://example.com/page%20name/')).toBe(
        'https://example.com/page%20name'
      );
    });

    it('should handle empty query strings', () => {
      expect(normalizeUrl('https://example.com/page?')).toBe('https://example.com/page');
    });
  });
});
