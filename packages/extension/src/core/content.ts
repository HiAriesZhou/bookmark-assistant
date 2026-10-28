export interface PageDescription {
  /** The document the description was read from, so callers can drop a stale read. */
  url: string;
  description?: string;
}

/**
 * Reads the page's own summary from its meta tags. It runs inside the page through
 * chrome.scripting, so it must not reference anything outside its body.
 */
export function readPageDescription(documentRef: Document = document): PageDescription {
  const maxLength = 1000;
  const selectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];
  for (const selector of selectors) {
    const content = documentRef.querySelector(selector)?.getAttribute('content')?.trim();
    if (content)
      return { url: documentRef.location.href, description: content.slice(0, maxLength) };
  }
  return { url: documentRef.location.href };
}
