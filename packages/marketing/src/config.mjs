import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
export const OUTPUT_DIR = join(PACKAGE_DIR, 'generated');
export const SCREENSHOT_DIR = join(OUTPUT_DIR, 'screenshots');
export const PROMO_DIR = join(OUTPUT_DIR, 'promo');
export const WEBSITE_DIR = join(OUTPUT_DIR, 'website');
export const REVIEW_DIR = join(OUTPUT_DIR, 'review');
export const CANDIDATE_STORE_DIR = join(OUTPUT_DIR, 'candidates/store');
export const PACKAGE_OUTPUT_DIR = join(OUTPUT_DIR, 'chrome-web-store-upload');
export const APPROVED_STORE_DIR = join(REPO_ROOT, 'packages/marketing/assets/store');
export const APPROVED_WEBSITE_DIR = join(REPO_ROOT, 'packages/marketing/assets/website');
const sharedRoot = join(REPO_ROOT, 'packages/shared');
const brand = JSON.parse(await readFile(join(sharedRoot, 'brand.json'), 'utf8'));
const brandAsset = (asset) => join(sharedRoot, asset);

export const MARKETING_LOCALES = ['en', 'zh-CN'];
export const FROZEN_TIME = '2026-09-14T10:00:00.000Z';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:4179';

export const SCENES = [
  {
    id: 'local-library',
    scenario: 'disconnected-report',
    surface: 'options',
    route: 'library',
  },
  {
    id: 'optional-destination',
    scenario: 'connected',
    surface: 'options',
    route: 'destinations',
  },
  {
    id: 'sync-and-ai-ready',
    scenario: 'sync-success',
    surface: 'options',
    route: 'destinations',
  },
  {
    // AI organize starts from the library toolbar.
    id: 'ai-summary-tags',
    scenario: 'sync-success',
    surface: 'options',
    route: 'library',
  },
  {
    id: 'pro-auto-sync',
    scenario: 'auto-sync',
    surface: 'options',
    route: 'settings',
    scrollTarget: '#sync',
  },
];

export const DIMENSIONS = {
  screenshot: { width: 1280, height: 800 },
  storeIcon: { width: 128, height: 128 },
  smallPromo: { width: 440, height: 280 },
  marquee: { width: 1400, height: 560 },
  og: { width: 1200, height: 630 },
  contactSheet: { width: 2000, height: 820 },
};

export const APPROVED_STORE_ASSETS = {
  storeIcon: brandAsset(brand.assets.logo.store),
  smallPromo: join(APPROVED_STORE_DIR, 'small-promo.png'),
  marquee: join(APPROVED_STORE_DIR, 'marquee.png'),
};

export const APPROVED_WEBSITE_ASSETS = {
  og: join(APPROVED_WEBSITE_DIR, 'bookmark-assistant-og.png'),
};

export async function loadContent(locale) {
  return JSON.parse(
    await readFile(join(REPO_ROOT, 'packages/marketing/content', `${locale}.json`), 'utf8')
  );
}

export const logoPath = brandAsset(brand.assets.logo.store);

export async function loadProductVersion() {
  const product = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  return product.version;
}

export function screenshotFilename(locale, index, sceneId) {
  return join(SCREENSHOT_DIR, locale, `${String(index + 1).padStart(2, '0')}-${sceneId}.png`);
}
