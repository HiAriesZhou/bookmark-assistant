// The Chrome Web Store build of the official extension.
export const OFFICIAL_EXTENSION_ID = 'khffaaemphidjmhokafmiilkcjpgiije';

/**
 * CSP frame-ancestors for /checkout: the site itself and the extensions that may embed the
 * checkout. CHECKOUT_EXTENSION_IDS (comma-separated) adds others, such as a local unpacked
 * build; the official site always allows its store extension.
 */
export function checkoutFrameAncestors({ extensionIds = '', officialService = false } = {}) {
  const ids = extensionIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[a-p]{32}$/.test(id));
  const allowed = [...new Set([...(officialService ? [OFFICIAL_EXTENSION_ID] : []), ...ids])];
  return ["frame-ancestors 'self'", ...allowed.map((id) => `chrome-extension://${id}`)].join(' ');
}
