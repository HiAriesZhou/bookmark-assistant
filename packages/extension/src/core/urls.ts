import { normalizeLinkUrl } from '@bookmark-assistant/types';

/**
 * Normalizes URLs to ensure consistent cache keys.
 * Handles:
 * - trailing slashes, except the root path
 * - query parameter sorting
 * - fragment removal
 * - URL encoding normalization
 */
export function normalizeUrl(url: string): string {
  try {
    return normalizeLinkUrl(url);
  } catch {
    console.warn('[URLNormalizer] Failed to normalize an invalid URL.');
    return url;
  }
}
