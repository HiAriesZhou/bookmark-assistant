import { readFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Public endpoints of the official hosted service. These values ship in every store
 * package; none of them is a credential. The Notion client ID is public by design.
 */
export const OFFICIAL_SERVICE = Object.freeze({
  apiUrl: 'https://bookmark-assistant-server.vercel.app',
  websiteUrl: 'https://bookmarkassistant.com',
  notionClientId: '257d872b-594c-805a-9f58-0037c0162612',
  faqUrl: 'https://bookmarkassistant.com/#faq',
  privacyUrl: 'https://bookmarkassistant.com/privacy',
  termsUrl:
    'https://www.notion.so/bookmark-assistant/Terms-of-Service-2a24fd51dd3e80258c2df46cab36d400',
  supportUrl: 'mailto:aries0331.dev@gmail.com',
});

const LOCAL_SERVICE = Object.freeze({
  apiUrl: 'http://localhost:3333',
  websiteUrl: 'http://localhost:3001',
});

export function brandFiles(config) {
  return [
    ...new Set([
      ...Object.values(config.brand.assets.logo),
      ...Object.values(config.brand.assets.favicon),
    ]),
  ].map((asset) => {
    const source = resolve(ROOT, 'packages/shared', asset);
    const target = relative(config.brandRoot, source);
    if (isAbsolute(target) || target.startsWith('..'))
      throw new Error('Brand input escapes its asset directory.');
    return { source, target };
  });
}

function parseApiOrigin(apiUrl) {
  const parsed = new URL(apiUrl);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('VITE_OAUTH_SERVER_URL must be a plain HTTP(S) origin without credentials.');
  }
  if (
    parsed.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error('Non-local API origins require HTTPS.');
  }
  return parsed.origin;
}

/**
 * Resolves the single product build. Production builds connect to the official
 * service unless VITE_OAUTH_SERVER_URL selects another server; development builds
 * default to a local server. Official links apply only to the official service.
 */
export function resolveBuildConfig(env = process.env, { development = false } = {}) {
  const brand = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/brand.json'), 'utf8'));
  const apiUrl = parseApiOrigin(
    env.VITE_OAUTH_SERVER_URL?.trim() ||
      (development ? LOCAL_SERVICE.apiUrl : OFFICIAL_SERVICE.apiUrl)
  );
  const officialService = apiUrl === OFFICIAL_SERVICE.apiUrl;
  const official = (key) => (officialService ? OFFICIAL_SERVICE[key] : '');
  const websiteUrl =
    env.VITE_WEBSITE_URL ||
    (officialService ? OFFICIAL_SERVICE.websiteUrl : LOCAL_SERVICE.websiteUrl);
  return {
    brand,
    brandRoot: resolve(ROOT, 'packages/shared', brand.assets.root),
    apiUrl,
    websiteUrl,
    officialService,
    publicAssetsPath: '/product',
    publicEnv: {
      VITE_OFFICIAL_SERVICE: String(officialService),
      VITE_APP_NAME: brand.name,
      VITE_OAUTH_SERVER_URL: apiUrl,
      VITE_NOTION_CLIENT_ID: env.VITE_NOTION_CLIENT_ID?.trim() || official('notionClientId'),
      VITE_WEBSITE_URL: websiteUrl,
      VITE_FAQ_URL: env.VITE_FAQ_URL || official('faqUrl'),
      VITE_PRIVACY_URL: env.VITE_PRIVACY_URL || official('privacyUrl'),
      VITE_TERMS_URL: env.VITE_TERMS_URL || official('termsUrl'),
      VITE_SUPPORT_URL: env.VITE_SUPPORT_URL || official('supportUrl'),
      VITE_DEBUG_MODE: env.VITE_DEBUG_MODE || 'false',
    },
  };
}
