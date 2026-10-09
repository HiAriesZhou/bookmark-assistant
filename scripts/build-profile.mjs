import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function brandFiles(profile) {
  return [
    ...new Set([
      ...Object.values(profile.brand.assets.logo),
      ...Object.values(profile.brand.assets.favicon),
    ]),
  ].map((asset) => {
    const source = resolve(profile.assetRoot, 'packages/shared', asset);
    const target = relative(profile.brandRoot, source);
    if (isAbsolute(target) || target.startsWith('..'))
      throw new Error('Brand input escapes its asset directory.');
    return { source, target };
  });
}

export function resolveBuildProfile(env = process.env) {
  const profile = env.BOOKMARK_ASSISTANT_BUILD_PROFILE || 'community';
  if (!['community', 'official'].includes(profile)) throw new Error('Unknown build profile.');
  const official = profile === 'official';
  const notionClientId = env.VITE_NOTION_CLIENT_ID?.trim() || '';
  // Community builds may run as a local-only library; official builds must connect Notion.
  if (official && !notionClientId)
    throw new Error('Official builds require VITE_NOTION_CLIENT_ID.');
  const assetRoot = official
    ? resolve(env.BOOKMARK_ASSISTANT_OFFICIAL_ASSETS || resolve(ROOT, '.official-assets'))
    : ROOT;
  const brandFile = resolve(assetRoot, 'packages/shared/brand.json');
  if (!existsSync(brandFile))
    throw new Error('Official assets are missing. Set BOOKMARK_ASSISTANT_OFFICIAL_ASSETS.');
  const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
  if (!official && env.VITE_APP_NAME) brand.name = env.VITE_APP_NAME;
  if (
    official &&
    (brand.name !== 'Bookmark Assistant' || !existsSync(resolve(assetRoot, 'assets.lock.json')))
  )
    throw new Error('Official builds require the official brand and a versioned asset lock.');
  if (official) {
    const lock = JSON.parse(readFileSync(resolve(assetRoot, 'assets.lock.json'), 'utf8'));
    if (lock.schemaVersion !== 1 || !lock.files || !Object.keys(lock.files).length)
      throw new Error('Invalid official asset lock.');
    for (const [file, expected] of Object.entries(lock.files)) {
      const location = resolve(assetRoot, file);
      if (isAbsolute(file) || relative(assetRoot, location).startsWith('..'))
        throw new Error('Asset lock path escapes its workspace.');
      if (createHash('sha256').update(readFileSync(location)).digest('hex') !== expected)
        throw new Error(
          `Official asset has changed: ${file}. Review it and refresh its lock before building.`
        );
    }
  }
  const apiUrl = official
    ? 'https://bookmark-assistant-server.vercel.app'
    : env.VITE_OAUTH_SERVER_URL || 'http://localhost:3333';
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
  const websiteUrl = official
    ? 'https://bookmarkassistant.com'
    : env.VITE_WEBSITE_URL || 'http://localhost:3001';
  return {
    profile,
    official,
    assetRoot,
    brand,
    brandRoot: resolve(assetRoot, 'packages/shared', brand.assets.root),
    apiUrl: parsed.origin,
    websiteUrl,
    publicAssetsPath: `/product/${profile}`,
    contentRoot: resolve(assetRoot, 'packages/marketing/content'),
    publicEnv: {
      VITE_BUILD_PROFILE: profile,
      VITE_APP_NAME: brand.name,
      VITE_OAUTH_SERVER_URL: parsed.origin,
      VITE_NOTION_CLIENT_ID: notionClientId,
      VITE_WEBSITE_URL: websiteUrl,
      VITE_FAQ_URL: official ? `${websiteUrl}/#faq` : env.VITE_FAQ_URL || '',
      VITE_PRIVACY_URL: official ? `${websiteUrl}/privacy` : env.VITE_PRIVACY_URL || '',
      VITE_TERMS_URL: official
        ? 'https://www.notion.so/bookmark-assistant/Terms-of-Service-2a24fd51dd3e80258c2df46cab36d400'
        : env.VITE_TERMS_URL || '',
      VITE_SUPPORT_URL: official ? 'mailto:aries0331.dev@gmail.com' : env.VITE_SUPPORT_URL || '',
      VITE_DEBUG_MODE: env.VITE_DEBUG_MODE || 'false',
    },
  };
}
