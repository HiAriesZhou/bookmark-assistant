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
  private readonly maxHtmlSize = 5 * 1024 * 1024; // 5MB
  private readonly userAgent = 'BookmarkAssistant/1.0 (+https://bookmark-assistant.com)';

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
   * Fetch HTML from URL
   */
  private async fetchHtml(url: string): Promise<{ html: string | null; error?: string }> {
    try {
      // Use native fetch (Node.js 18+)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
          // @ts-expect-error - size limit not in types but supported
          size: this.maxHtmlSize,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(`[DescriptionExtractor] HTTP ${response.status} while fetching description`);
          return { html: null, error: `HTTP ${response.status}` };
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          console.warn(`[DescriptionExtractor] Non-HTML content type: ${contentType}`);
          return { html: null, error: `Non-HTML content type: ${contentType || 'unknown'}` };
        }

        const html = await response.text();
        return { html };
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          console.warn('[DescriptionExtractor] Timed out while fetching description');
          return { html: null, error: 'Request timed out' };
        } else {
          console.warn('[DescriptionExtractor] Failed to fetch description');
          return { html: null, error: error.message || 'Failed to fetch HTML' };
        }
      }
    } catch {
      console.error('[DescriptionExtractor] Failed to fetch description');
      return { html: null, error: 'Failed to fetch HTML' };
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
