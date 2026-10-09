/**
 * Extracts page description from meta tags with priority:
 * 1. <meta name='description'> content
 * 2. <meta property='og:description'> content
 * 3. Fallback to empty string
 */

import { normalizeUrl } from '../core';

function extractPageDescription(): string {
  console.debug('[DescriptionExtractor] Extracting page description');

  // Priority 1: <meta name='description'>
  const metaDescription = document
    .querySelector('meta[name="description"]')
    ?.getAttribute('content');
  console.log(
    `[DescriptionExtractor] Found meta[name="description"]: ${metaDescription ? `"${metaDescription}"` : 'null'}`
  );

  if (metaDescription && metaDescription.trim()) {
    const result = metaDescription.trim();
    console.debug('[DescriptionExtractor] Using meta description');
    return result;
  }

  // Priority 2: <meta property='og:description'>
  const ogDescription = document
    .querySelector('meta[property="og:description"]')
    ?.getAttribute('content');
  console.log(
    `[DescriptionExtractor] Found meta[property="og:description"]: ${ogDescription ? `"${ogDescription}"` : 'null'}`
  );

  if (ogDescription && ogDescription.trim()) {
    const result = ogDescription.trim();
    console.debug('[DescriptionExtractor] Using og:description');
    return result;
  }

  // Priority 3: Fallback to empty string
  console.log('[DescriptionExtractor] No description meta tags found, using empty string');
  return '';
}

// Extract description on page load
const description = extractPageDescription();
const currentUrl = window.location.href;
const normalizedUrl = normalizeUrl(currentUrl);
console.log(
  `[DescriptionExtractor] Final description for ${currentUrl} (normalized: ${normalizedUrl}): "${description}"`
);

// Send to background script (with normalized URL)
chrome.runtime
  .sendMessage({
    type: 'PAGE_DESCRIPTION',
    payload: {
      url: normalizedUrl,
      description,
    },
  })
  .then(() => {
    console.log(`[DescriptionExtractor] Successfully sent description to background script`);
  })
  .catch(() => {
    // Silently fail if background script is not available
    // This can happen during page navigation
    console.debug('[DescriptionExtractor] Failed to send page description to background');
  });

// Also try to detect if page is still loading
if (document.readyState === 'loading') {
  console.log('[DescriptionExtractor] Page still loading, will re-extract on DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[DescriptionExtractor] DOM loaded, re-extracting description');
    const reExtractedDescription = extractPageDescription();
    const reExtractedUrl = normalizeUrl(window.location.href);
    if (reExtractedDescription !== description || reExtractedUrl !== normalizedUrl) {
      console.log('[DescriptionExtractor] Description or URL changed after load, sending update');
      chrome.runtime
        .sendMessage({
          type: 'PAGE_DESCRIPTION',
          payload: {
            url: reExtractedUrl,
            description: reExtractedDescription,
          },
        })
        .catch(() => {});
    }
  });
}
