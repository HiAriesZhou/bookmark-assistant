import { normalizeLinkUrl } from '@bookmark-assistant/types';

/**
 * Normalize URLs for stable sync and cache keys.
 *
 * The behavior intentionally matches the extension-side URL normalizer:
 * remove fragments, sort query parameters, and remove non-root trailing slashes.
 * Invalid input is returned unchanged so callers can validate separately.
 */
export function normalizeUrlForSync(url: string): string {
  try {
    return normalizeLinkUrl(url);
  } catch {
    return url;
  }
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isFetchableHttpUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface BuildGoogleS2FaviconUrlOptions {
  size?: number;
}

export function buildGoogleS2FaviconUrl(
  url: string,
  options: BuildGoogleS2FaviconUrlOptions = {}
): string | undefined {
  try {
    const hostname = new URL(url).hostname;
    const size = options.size ?? 64;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`;
  } catch {
    return undefined;
  }
}
