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
    const urlObj = new URL(url);

    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    urlObj.hash = '';

    if (urlObj.search && urlObj.search !== '?') {
      const params = new URLSearchParams(urlObj.search);
      const sortedParams = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
      urlObj.search = new URLSearchParams(sortedParams).toString();
    } else {
      urlObj.search = '';
    }

    return urlObj.toString();
  } catch {
    console.warn('[URLNormalizer] Failed to normalize an invalid URL.');
    return url;
  }
}
