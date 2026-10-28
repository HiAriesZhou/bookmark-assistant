import { readFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Public links of the official build. These values ship in every store package;
 * none of them is a credential.
 */
export const OFFICIAL_LINKS = Object.freeze({
  websiteUrl: 'https://bookmarkassistant.com',
  faqUrl: 'https://bookmarkassistant.com/#faq',
  privacyUrl: 'https://bookmarkassistant.com/privacy',
  termsUrl:
    'https://www.notion.so/bookmark-assistant/Terms-of-Service-2a24fd51dd3e80258c2df46cab36d400',
  supportUrl: 'mailto:aries0331.dev@gmail.com',
  sourceUrl: 'https://github.com/HiAriesZhou/bookmark-assistant',
});

const LOCAL_WEBSITE_URL = 'http://localhost:3001';

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

function parseWebsiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_WEBSITE_URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('VITE_WEBSITE_URL must be an HTTP(S) URL without credentials.');
  return parsed.href.replace(/\/$/, '');
}

/**
 * Resolves the single product build. The extension talks to no service of its own.
 * A build is official unless it is a development build or VITE_WEBSITE_URL names a
 * site other than the official one. Official links cannot be overridden in the
 * official build; other builds set their own.
 */
export function resolveBuildConfig(env = process.env, { development = false } = {}) {
  const brand = JSON.parse(readFileSync(resolve(ROOT, 'packages/shared/brand.json'), 'utf8'));
  const requestedSite = env.VITE_WEBSITE_URL?.trim();
  const siteUrl = requestedSite ? parseWebsiteUrl(requestedSite) : '';
  const officialBuild = !development && (!siteUrl || siteUrl === OFFICIAL_LINKS.websiteUrl);
  const link = (key, envKey, fallback = '') =>
    officialBuild ? OFFICIAL_LINKS[key] : env[envKey]?.trim() || fallback;
  return {
    brand,
    brandRoot: resolve(ROOT, 'packages/shared', brand.assets.root),
    websiteUrl: officialBuild ? OFFICIAL_LINKS.websiteUrl : siteUrl || LOCAL_WEBSITE_URL,
    officialBuild,
    publicAssetsPath: '/product',
    publicEnv: {
      VITE_APP_NAME: brand.name,
      VITE_FAQ_URL: link('faqUrl', 'VITE_FAQ_URL'),
      VITE_PRIVACY_URL: link('privacyUrl', 'VITE_PRIVACY_URL'),
      VITE_TERMS_URL: link('termsUrl', 'VITE_TERMS_URL'),
      // Other builds may publish their own GPL source; the upstream repository is the default.
      VITE_SOURCE_URL: link('sourceUrl', 'VITE_SOURCE_URL', OFFICIAL_LINKS.sourceUrl),
    },
  };
}
