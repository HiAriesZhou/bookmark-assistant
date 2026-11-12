export const OFFICIAL_BUILD = process.env.NEXT_PUBLIC_OFFICIAL_BUILD === 'true';
export const AUTHOR_URL = 'https://x.com/AriesZhou';

export const CHROME_WEB_STORE_URL =
  process.env.NEXT_PUBLIC_INSTALL_URL ||
  (OFFICIAL_BUILD
    ? 'https://chromewebstore.google.com/detail/khffaaemphidjmhokafmiilkcjpgiije?utm_source=bookmarkassistant.com&utm_medium=website&utm_campaign=growth_system_v1'
    : '#source');

export const NOTION_TOKEN_GUIDE_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens';

export const TERMS_OF_SERVICE_URL =
  process.env.NEXT_PUBLIC_TERMS_URL ||
  (OFFICIAL_BUILD
    ? 'https://www.notion.so/bookmark-assistant/Terms-of-Service-2a24fd51dd3e80258c2df46cab36d400'
    : '/privacy');

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || (OFFICIAL_BUILD ? 'aries0331.dev@gmail.com' : '');

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';

export const PRODUCT_HUNT_URL = OFFICIAL_BUILD
  ? 'https://www.producthunt.com/products/bookmark-assistant?utm_source=bookmarkassistant.com&utm_medium=website&utm_campaign=growth_system_v1'
  : '';

export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Bookmark Assistant';
export const ASSET_PREFIX = process.env.NEXT_PUBLIC_ASSET_PREFIX || '/product';
export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL || 'https://github.com/HiAriesZhou/bookmark-assistant';

// Credit the official author; other builds keep their own source link.
export function authorOrSourceUrl(): string {
  return OFFICIAL_BUILD ? AUTHOR_URL : SOURCE_URL;
}
