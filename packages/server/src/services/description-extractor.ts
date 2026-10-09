/**
 * Server-side description extraction service
 * Fetches URLs and extracts descriptions from meta tags
 */

import {
  extractContentFromStructuredElements,
  extractDescriptionFromHtml,
  isFetchableHttpUrl,
  isValidUrl,
  isValidDescription,
  looksLikeDescription,
  normalizeUrlForSync,
  sanitizeDescription,
} from '../core';
import { descriptionCache } from './description-cache';
import { fetchPublicHtml, PublicPageFetchError } from './public-page-fetcher';

export interface ExtractionResult {
  description: string;
  source: 'meta_description' | 'og_description' | 'title' | 'content' | 'empty';
  success: boolean;
  error?: string;
  url: string;
  fromCache?: boolean;
}

export class DescriptionExtractor {
  private readonly timeoutMs = 5000; // 5 seconds
  // Descriptions come from the document head or first paragraphs.
  private readonly maxHtmlBytes = 512 * 1024;

  /**
   * Extract description from a URL
   */
  async extractFromUrl(url: string): Promise<ExtractionResult> {
    try {
      // Normalize URL for consistent caching
      const normalizedUrl = this.normalizeUrl(url);

      // Check cache first
      const cached = await descriptionCache.get(normalizedUrl);
      if (cached) {
        console.debug('[DescriptionExtractor] Cache hit');
        return {
          description: cached.description,
          source: cached.source,
          success: true,
          url: normalizedUrl,
          fromCache: true,
        };
      }

      console.debug('[DescriptionExtractor] Cache miss, fetching');

      // Validate URL
      if (!this.isValidUrl(normalizedUrl)) {
        return {
          description: '',
          source: 'empty',
          success: false,
          error: 'Invalid URL',
          url: normalizedUrl,
          fromCache: false,
        };
      }

      // Skip non-HTTP URLs
      if (!this.isFetchableUrl(normalizedUrl)) {
        return {
          description: '',
          source: 'empty',
          success: false,
          error: 'URL is not fetchable',
          url: normalizedUrl,
          fromCache: false,
        };
      }

      // Fetch HTML
      const fetchResult = await this.fetchHtml(normalizedUrl);
      if (!fetchResult.html) {
        return {
          description: '',
          source: 'empty',
          success: false,
          error: fetchResult.error || 'Failed to fetch HTML',
          url: normalizedUrl,
          fromCache: false,
        };
      }

      // Extract description
      const description = this.extractDescription(fetchResult.html);

      // Cache the result (async, don't wait)
      if (description.text) {
        descriptionCache
          .set(normalizedUrl, description.text, description.source)
          .catch((err) => console.warn('[DescriptionExtractor] Failed to cache:', err));
      }

      return {
        description: description.text,
        source: description.source,
        success: true,
        url: normalizedUrl,
        fromCache: false,
      };
    } catch (error) {
      return {
        description: '',
        source: 'empty',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        fromCache: false,
      };
    }
  }

  /**
   * Extract description from HTML string
   */
  private extractDescription(html: string): { text: string; source: ExtractionResult['source'] } {
    return extractDescriptionFromHtml(html);
  }

  /**
   * Fetch HTML from a public URL. Private addresses, non-standard ports and
   * redirects into private networks are rejected; only the first part of large
   * pages is downloaded.
   */
  private async fetchHtml(url: string): Promise<{ html: string | null; error?: string }> {
    try {
      const html = await fetchPublicHtml(url, {
        maxBytes: this.maxHtmlBytes,
        timeoutMs: this.timeoutMs,
      });
      return { html };
    } catch (error) {
      const reason = error instanceof PublicPageFetchError ? error.code : 'fetch_failed';
      console.warn(`[DescriptionExtractor] Skipped description fetch: ${reason}`);
      return { html: null, error: reason };
    }
  }

  /**
   * Validate URL
   */
  private isValidUrl(url: string): boolean {
    return isValidUrl(url);
  }

  /**
   * Check if URL is fetchable (HTTP/HTTPS only)
   */
  private isFetchableUrl(url: string): boolean {
    return isFetchableHttpUrl(url);
  }

  /**
   * Extract content from structured elements (main, article, section)
   */
  private extractContentFromStructuredElements(
    html: string
  ): { text: string; source: ExtractionResult['source'] } | null {
    return extractContentFromStructuredElements(html);
  }

  /**
   * Check if text looks like a description (not just a title or navigation)
   */
  private looksLikeDescription(text: string): boolean {
    return looksLikeDescription(text);
  }

  /**
   * Check if a description is valid (not a title, not just branding)
   */
  private isValidDescription(text: string): boolean {
    return isValidDescription(text);
  }

  /**
   * Sanitize description text
   */
  private sanitizeDescription(text: string): string {
    return sanitizeDescription(text);
  }

  /**
   * Normalize URL for caching (same logic as client)
   */
  normalizeUrl(url: string): string {
    return normalizeUrlForSync(url);
  }
}

// Singleton instance
export const descriptionExtractor = new DescriptionExtractor();
