/** Normalize valid URLs for stable sync and cache keys. Invalid URLs throw. */
export function normalizeLinkUrl(url: string): string {
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
}
