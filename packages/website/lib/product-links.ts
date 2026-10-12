const OFFICIAL_SERVICE = process.env.NEXT_PUBLIC_OFFICIAL_SERVICE === 'true';

export const CHROME_WEB_STORE_URL =
  process.env.NEXT_PUBLIC_INSTALL_URL ||
  (OFFICIAL_SERVICE
    ? 'https://chromewebstore.google.com/detail/khffaaemphidjmhokafmiilkcjpgiije?utm_source=bookmarkassistant.com&utm_medium=website&utm_campaign=growth_system_v1'
    : '#source');

export const NOTION_TEMPLATE_URL =
  process.env.NEXT_PUBLIC_NOTION_TEMPLATE_URL ||
  (OFFICIAL_SERVICE
    ? 'https://glow-pheasant-22f.notion.site/Bookmark-Assistant-Dashboard-2ce9466de76d80a49879d40f259ced08?pvs=143'
    : '');

export const TERMS_OF_SERVICE_URL =
  process.env.NEXT_PUBLIC_TERMS_URL ||
  (OFFICIAL_SERVICE
    ? 'https://www.notion.so/bookmark-assistant/Terms-of-Service-2a24fd51dd3e80258c2df46cab36d400'
    : '/privacy');

export const REFUND_POLICY_URL =
  process.env.NEXT_PUBLIC_REFUND_URL ||
  (OFFICIAL_SERVICE
    ? 'https://bookmark-assistant.notion.site/Refund-Policy-2a24fd51dd3e80ae9553e0ab34a55bd2'
    : '/privacy');

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || (OFFICIAL_SERVICE ? 'aries0331.dev@gmail.com' : '');

export const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';

export const PRODUCT_HUNT_URL = OFFICIAL_SERVICE
  ? 'https://www.producthunt.com/products/bookmark-assistant?utm_source=bookmarkassistant.com&utm_medium=website&utm_campaign=growth_system_v1'
  : '';

export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Bookmark Assistant';
export const COMMERCE_ENABLED = process.env.NEXT_PUBLIC_COMMERCE_ENABLED === 'true';
export const ASSET_PREFIX = process.env.NEXT_PUBLIC_ASSET_PREFIX || '/product';
export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL || 'https://github.com/HiAriesZhou/bookmark-assistant';
