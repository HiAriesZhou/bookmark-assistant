import { normalizeLinkUrl } from '@bookmark-assistant/types';

/**
 * Normalizes URLs to ensure consistent cache keys.
 * Handles:
 * - trailing slashes, except the root path
 * - query parameter sorting
 * - fragment removal
 * - URL encoding normalization
 */
// Captures are limited to web pages; local files and browser or extension pages
// stay on the device.
export function isWebPageUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  try {
    return normalizeLinkUrl(url);
  } catch {
    console.warn('[URLNormalizer] Failed to normalize an invalid URL.');
    return url;
  }
}
