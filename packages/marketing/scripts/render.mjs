import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import {
  APPROVED_STORE_ASSETS,
  CANDIDATE_STORE_DIR,
  DEFAULT_BASE_URL,
  DIMENSIONS,
  FROZEN_TIME,
  MARKETING_LOCALES,
  OUTPUT_DIR,
  PROMO_DIR,
  REPO_ROOT,
  SCENES,
  SCREENSHOT_DIR,
  WEBSITE_DIR,
  loadContent,
  loadProductVersion,
  logoPath,
  screenshotFilename,
} from '../src/config.mjs';
import { globalOverviewCanvas, marqueeCanvas, screenshotCanvas } from '../src/canvas.mjs';

const externalBaseUrl = process.env.MARKETING_BASE_URL;
const baseUrl = externalBaseUrl || DEFAULT_BASE_URL;
let server;
let serverClosed = false;

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the extension preview at ${url}`);
}

async function startServer() {
  if (externalBaseUrl) return;
  // `npm_execpath` is pnpm's internal JavaScript entrypoint. Spawning it directly
  // can omit the extension workspace's local executable paths, including Vite.
  const command = process.env.PNPM_EXECUTABLE || 'pnpm';
  server = spawn(
    command,
    [
      '--filter',
      '@bookmark-assistant/extension',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      '4179',
      '--strictPort',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }
  );
  let diagnostics = '';
  server.stdout.on('data', (chunk) => (diagnostics += chunk.toString()));
  server.stderr.on('data', (chunk) => (diagnostics += chunk.toString()));
  server.on('close', () => {
    serverClosed = true;
  });
  server.on('exit', (code) => {
    if (code && code !== 0) process.stderr.write(diagnostics);
  });
  await waitForServer(`${baseUrl}/src/dev/index.html`);
}

async function waitForServerExit(timeoutMs) {
  if (!server || serverClosed) return true;
  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      server?.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    server.once('close', onClose);
  });
}

function signalServer(signal) {
  if (!server?.pid) return;
  if (process.platform === 'win32') {
    server.kill(signal);
    return;
  }
  try {
    process.kill(-server.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function stopServer() {
  if (!server) return;
  signalServer('SIGTERM');
  if (await waitForServerExit(5_000)) return;
  signalServer('SIGKILL');
  if (!(await waitForServerExit(5_000))) {
    throw new Error('Timed out while stopping the extension preview server.');
  }
}

async function launchBrowser() {
  return chromium.launch({ channel: 'chromium', headless: true });
}

function asDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function preparePage(page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(baseUrl) || url.startsWith('data:')) await route.continue();
    else await route.abort();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });
  });
}

async function captureProduct(browser, locale, scene) {
  const context = await browser.newContext({
    viewport:
      scene.viewport ||
      (scene.surface === 'popup' ? { width: 420, height: 650 } : { width: 1280, height: 900 }),
    deviceScaleFactor: 1,
    locale: locale === 'zh-CN' ? 'zh-CN' : locale,
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await preparePage(page);
  const entry = scene.surface === 'popup' ? '/src/dev/popup.html' : '/src/dev/index.html';
  const route = scene.route ? `#/${scene.route}` : '';
  const url = `${baseUrl}${entry}?scenario=${scene.scenario}&locale=${locale}&time=${encodeURIComponent(FROZEN_TIME)}${route}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(
    `html[data-demo-ready="true"][data-demo-scenario="${scene.scenario}"]`
  );
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}body{cursor:none!important}`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  if (scene.scrollTarget) {
    await page.locator(scene.scrollTarget).scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  let screenshot;
  if (scene.surface === 'popup') {
    const popup = page.locator('#popup-root > div').first();
    await popup.waitFor({ state: 'visible' });
    const bounds = await popup.boundingBox();
    if (
      !bounds ||
      bounds.width < 360 ||
      bounds.width > 420 ||
      bounds.height < 180 ||
      bounds.height > 420
    ) {
      throw new Error(
        `Unexpected popup bounds for ${locale}/${scene.id}: ${JSON.stringify(bounds)}`
      );
    }
    screenshot = await popup.screenshot({
      type: 'png',
      timeout: 60_000,
    });
  } else {
    screenshot = await page.screenshot({
      type: 'png',
      timeout: 60_000,
    });
  }
  const state = await page.evaluate(() => window.__BOOKMARK_ASSISTANT_DEMO__);
  await context.close();
  if (!state?.ready || state.scenario !== scene.scenario || state.locale !== locale) {
    throw new Error(`Demo scene did not become deterministic: ${locale}/${scene.id}`);
  }
  return screenshot;
}

async function captureHtml(browser, html, dimensions, outputPath) {
  const context = await browser.newContext({
    viewport: dimensions,
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: outputPath,
    type: 'png',
    timeout: 60_000,
  });
  await context.close();
}

await rm(OUTPUT_DIR, { recursive: true, force: true });
await Promise.all([
  ...MARKETING_LOCALES.map((locale) => mkdir(`${SCREENSHOT_DIR}/${locale}`, { recursive: true })),
  mkdir(PROMO_DIR, { recursive: true }),
  mkdir(CANDIDATE_STORE_DIR, { recursive: true }),
  mkdir(WEBSITE_DIR, { recursive: true }),
  mkdir(`${SCREENSHOT_DIR}/global`, { recursive: true }),
]);

let browser;
try {
  await startServer();
  browser = await launchBrowser();
  const logo = asDataUrl(await readFile(logoPath));
  const manifest = {
    schemaVersion: 2,
    productVersion: await loadProductVersion(),
    frozenTime: FROZEN_TIME,
    syntheticFixturesOnly: true,
    sourceBaseUrl: baseUrl.replace(/:\d+$/, ':<local-port>'),
    screenshots: [],
    assets: [],
    candidates: [],
  };
  let marqueeProduct;
  for (const locale of MARKETING_LOCALES) {
    const content = await loadContent(locale);
    for (const [index, scene] of SCENES.entries()) {
      process.stdout.write(`Capturing ${locale}/${scene.id}...\n`);
      const copy = content.screenshots.find((item) => item.id === scene.id);
      if (!copy) throw new Error(`Missing ${locale} screenshot copy for ${scene.id}`);
      const product = await captureProduct(browser, locale, scene);
      if (locale === 'en' && scene.id === 'local-library') marqueeProduct = product;
      const outputPath = screenshotFilename(locale, index, scene.id);
      await captureHtml(
        browser,
        screenshotCanvas({
          locale,
          copy: { ...copy, productName: content.productName },
          scene,
          productImage: asDataUrl(product),
          logoImage: logo,
          index,
        }),
        DIMENSIONS.screenshot,
        outputPath
      );
      manifest.screenshots.push({
        locale,
        id: scene.id,
        scenario: scene.scenario,
        surface: scene.surface,
        file: outputPath.slice(OUTPUT_DIR.length + 1),
      });
    }
  }

  const overviewProduct = await captureProduct(browser, 'en', {
    ...SCENES[0],
    viewport: { width: 1280, height: 680 },
  });
  const overviewPath = `${SCREENSHOT_DIR}/global/01-overview.png`;
  await captureHtml(
    browser,
    globalOverviewCanvas({
      productImage: asDataUrl(overviewProduct),
      logoImage: logo,
      productName: (await loadContent('en')).productName,
    }),
    DIMENSIONS.screenshot,
    overviewPath
  );
  manifest.screenshots.push({
    locale: 'global',
    id: 'overview',
    scenario: SCENES[0].scenario,
    surface: 'options',
    file: 'screenshots/global/01-overview.png',
  });

  if (!marqueeProduct) throw new Error('Missing English local-library scene for marquee');
  const english = await loadContent('en');
  const marqueeCandidatePath = `${CANDIDATE_STORE_DIR}/marquee.png`;
  await captureHtml(
    browser,
    marqueeCanvas({
      copy: { ...english.store.marquee, productName: english.productName },
      productImage: asDataUrl(marqueeProduct),
      logoImage: logo,
    }),
    DIMENSIONS.marquee,
    marqueeCandidatePath
  );
  manifest.candidates.push({
    id: 'marquee',
    file: marqueeCandidatePath.slice(OUTPUT_DIR.length + 1),
    locale: 'en',
    ...DIMENSIONS.marquee,
  });

  const approvedAssets = [
    [
      'store-icon',
      APPROVED_STORE_ASSETS.storeIcon,
      DIMENSIONS.storeIcon,
      `${PROMO_DIR}/store-icon.png`,
    ],
    [
      'small-promo',
      APPROVED_STORE_ASSETS.smallPromo,
      DIMENSIONS.smallPromo,
      `${PROMO_DIR}/small-promo.png`,
    ],
    ['marquee', APPROVED_STORE_ASSETS.marquee, DIMENSIONS.marquee, `${PROMO_DIR}/marquee.png`],
  ];
  for (const [id, sourcePath, dimensions, outputPath] of approvedAssets) {
    await copyFile(sourcePath, outputPath);
    manifest.assets.push({
      id,
      file: outputPath.slice(OUTPUT_DIR.length + 1),
      source: sourcePath.slice(REPO_ROOT.length + 1),
      ...dimensions,
    });
  }

  const ogPath = `${WEBSITE_DIR}/og.png`;
  await sharp(APPROVED_STORE_ASSETS.marquee)
    .resize(DIMENSIONS.og.width, DIMENSIONS.og.height, {
      fit: 'contain',
      background: '#f6f5f1',
    })
    .flatten({ background: '#f6f5f1' })
    .png({ compressionLevel: 9 })
    .toFile(ogPath);
  manifest.assets.push({
    id: 'og-image',
    file: ogPath.slice(OUTPUT_DIR.length + 1),
    source: `derived:${APPROVED_STORE_ASSETS.marquee.slice(REPO_ROOT.length + 1)}`,
    ...DIMENSIONS.og,
  });

  const files = [...manifest.screenshots, ...manifest.assets, ...manifest.candidates];
  for (const item of files) {
    const data = await readFile(`${OUTPUT_DIR}/${item.file}`);
    item.sha256 = createHash('sha256').update(data).digest('hex');
  }
  await writeFile(`${OUTPUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `Rendered ${manifest.screenshots.length} screenshots and ${manifest.assets.length} supporting assets.\n`
  );
} finally {
  if (browser) await browser.close();
  await stopServer();
}
