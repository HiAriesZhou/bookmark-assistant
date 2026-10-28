import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { resolveBuildConfig } from '../../../scripts/build-config.mjs';
const config = resolveBuildConfig(process.env);
const canonicalSiteUrl = config.officialBuild
  ? config.websiteUrl
  : process.env.NEXT_PUBLIC_SITE_URL || config.websiteUrl;
const assetPrefix = config.publicAssetsPath;

const require = createRequire(import.meta.url);
const externalBaseUrl = process.env.WEBSITE_SMOKE_BASE_URL;
const baseUrl = externalBaseUrl || 'http://127.0.0.1:4301';
const siteOrigins = new Set([new URL(baseUrl).origin]);
let server;
let serverOutput = '';
let serverExit;

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (serverExit) {
      throw new Error(`Website server exited before readiness (${serverExit}).\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        siteOrigins.add(new URL(response.url).origin);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${serverOutput}`);
}

async function launchBrowser() {
  return chromium.launch({ channel: 'chromium', headless: true });
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function contrast(foreground, background) {
  const values = [foreground, background].map((value) => {
    const [red, green, blue] = value.match(/\d+/g).slice(0, 3).map(Number);
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  });
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

if (!externalBaseUrl) {
  const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
  const nextCli = require.resolve('next/dist/bin/next');
  const smokeEnvironment = {
    ...process.env,
    BROWSER: 'none',
    NEXT_PUBLIC_WEBSITE_CHANNEL: 'preview',
    NEXT_PUBLIC_SITE_URL: canonicalSiteUrl,
  };
  const build = spawnSync(process.execPath, [nextCli, 'build'], {
    cwd: websiteRoot,
    env: smokeEnvironment,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`Website smoke build failed.\n${build.stdout || ''}\n${build.stderr || ''}`);
  }
  server = spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '4301'],
    {
      cwd: websiteRoot,
      env: smokeEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const appendOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-16_000);
  };
  server.stdout.on('data', appendOutput);
  server.stderr.on('data', appendOutput);
  server.on('error', (error) => {
    serverExit = `spawn error: ${error.message}`;
  });
  server.on('exit', (code, signal) => {
    serverExit = `code=${code ?? 'null'} signal=${signal ?? 'none'}`;
  });
}

await waitForServer();
let browser;
try {
  browser = await launchBrowser();
  const routes = [
    {
      path: '/',
      lang: 'en',
      h1: 'Your Chrome bookmarks. Still in Chrome.',
      canonical: canonicalSiteUrl + '',
      privacy: false,
      positioningPhrases: [
        'without moving everything into another bookmark service',
        'AI folder suggestions stay optional.',
      ],
    },
    {
      path: '/zh-CN',
      lang: 'zh-CN',
      h1: '管理 Chrome 书签。 不必迁移。',
      canonical: canonicalSiteUrl + '/zh-CN',
      privacy: false,
      positioningPhrases: ['无需搬进另一套书签服务', 'AI 文件夹建议保持可选'],
    },
    {
      path: '/privacy',
      lang: 'en',
      h1: 'Privacy Policy',
      canonical: canonicalSiteUrl + '/privacy',
      privacy: true,
    },
    {
      path: '/zh-CN/privacy',
      lang: 'zh-CN',
      h1: '隐私政策',
      canonical: canonicalSiteUrl + '/zh-CN/privacy',
      privacy: true,
    },
    {
      path: '/success',
      lang: 'en',
      h1: `${config.brand.name} is now free`,
      canonical: canonicalSiteUrl + '/success',
      privacy: false,
      success: true,
    },
  ];

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    for (const routeInfo of routes) {
      const page = await browser.newPage({
        viewport,
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      await page.route('**/*', async (route) => {
        if (route.request().url().startsWith('https://api.producthunt.com/widgets/')) {
          await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="54"><rect width="250" height="54" fill="#fff"/></svg>',
          });
        } else if (siteOrigins.has(new URL(route.request().url()).origin)) await route.continue();
        else await route.abort();
      });
      const response = await page.goto(`${baseUrl}${routeInfo.path}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('h1').catch(async (error) => {
        const body = (await page.locator('body').innerText()).slice(0, 500);
        throw new Error(
          `No visible h1 on ${routeInfo.path} at ${viewport.width}px (${page.url()}, HTTP ${response?.status()}): ${body}`,
          { cause: error }
        );
      });
      const iconLinks = await page.locator('head link[rel="icon"]').evaluateAll((links) =>
        links.map((link) => ({
          href: link.getAttribute('href'),
          sizes: link.getAttribute('sizes'),
        }))
      );
      for (const size of [16, 32, 48]) {
        assert.ok(
          iconLinks.some(
            (icon) =>
              icon.href === `${assetPrefix}/brand/favicon/favicon-${size}x${size}.png` &&
              icon.sizes === `${size}x${size}`
          ),
          `Missing compact ${size}px favicon on ${routeInfo.path}`
        );
      }
      assert.ok(
        iconLinks.some(
          (icon) =>
            icon.href === `${assetPrefix}/brand/favicon/favicon.ico` &&
            icon.sizes === '16x16 32x32 48x48'
        ),
        `Missing multi-size ICO on ${routeInfo.path}`
      );
      if (routeInfo.path === '/' || routeInfo.path === '/zh-CN') {
        await page.waitForSelector('.editorial-metadata');
      }

      const state = await page.evaluate(() => {
        const primary = document.querySelector('.editorial-actions .editorial-install');
        const styles = primary ? getComputedStyle(primary) : null;
        return {
          lang: document.documentElement.lang,
          title: document.title,
          h1: document.querySelector('h1')?.innerText.replace(/\s+/g, ' ').trim(),
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
          alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(
            (link) => link.getAttribute('hreflang')
          ),
          bodyText: document.body.innerText,
          hasJsonLd: Boolean(document.querySelector('script[type="application/ld+json"]')),
          jsonLd: JSON.parse(
            document.querySelector('script[type="application/ld+json"]')?.textContent || 'null'
          ),
          hasMetadataPanel: Boolean(document.querySelector('.editorial-metadata')),
          syncTabCount: document.querySelectorAll('.editorial-sync-toolbar [role="tab"]').length,
          commerceText: /pricing|paddle|refund|subscription|\bpro\b|价格|订阅|退款/i.test(
            document.body.innerText
          ),
          hasLimitedUse: document.body.innerText.includes('Limited Use'),
          hasReturnTo: document.body.innerText.includes('return_to'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          primaryHref: primary?.getAttribute('href'),
          primaryForeground: styles?.color,
          primaryBackground: styles?.backgroundColor,
          brokenImages: [...document.images].filter(
            (image) => image.complete && image.naturalWidth === 0
          ).length,
          missingHashTargets: [...document.querySelectorAll('a[href^="#"]')]
            .map((anchor) => anchor.getAttribute('href'))
            .filter((href) => href && href !== '#' && !document.querySelector(href)).length,
        };
      });

      assert.ok(state.title.includes(config.brand.name));
      assert.equal(state.lang, routeInfo.lang);
      assert.equal(state.h1, routeInfo.h1);
      assert.equal(state.canonical, routeInfo.canonical);
      assert.ok(
        state.overflow <= 0,
        `${routeInfo.path} at ${viewport.width}px overflows by ${state.overflow}px`
      );
      assert.equal(state.brokenImages, 0);
      assert.equal(state.missingHashTargets, 0);
      for (const phrase of routeInfo.positioningPhrases ?? []) {
        assert.ok(state.bodyText.includes(phrase), `${routeInfo.path} is missing “${phrase}”`);
      }

      assert.equal(state.commerceText, false, `${routeInfo.path} mentions commerce`);
      if (routeInfo.success) {
        assert.deepEqual(state.alternates, []);
        assert.equal(state.hasJsonLd, false);
        assert.equal(state.hasReturnTo, false);
      } else {
        assert.deepEqual(new Set(state.alternates), new Set(['en', 'zh-CN', 'x-default']));
      }
      if (routeInfo.privacy) assert.equal(state.hasLimitedUse, true);
      if (routeInfo.path === '/' || routeInfo.path === '/zh-CN') {
        assert.equal(state.hasJsonLd, true);
        assert.equal(state.jsonLd.applicationSubCategory, 'Bookmark manager');
        assert.equal(state.jsonLd.browserRequirements, 'Requires Google Chrome');
        assert.equal(state.jsonLd.isAccessibleForFree, true);
        if (config.officialBuild)
          assert.match(state.jsonLd.installUrl, /khffaaemphidjmhokafmiilkcjpgiije/);
        else
          assert.equal(state.jsonLd.installUrl, process.env.NEXT_PUBLIC_INSTALL_URL || '#source');
        assert.equal(state.hasMetadataPanel, true);
        assert.equal(state.syncTabCount, 2);
        if (config.officialBuild)
          assert.match(state.primaryHref || '', /khffaaemphidjmhokafmiilkcjpgiije/);
        else {
          assert.equal(state.primaryHref, process.env.NEXT_PUBLIC_INSTALL_URL || '#source');
        }
        assert.equal(await page.locator('#pricing').count(), 0);
        assert.ok(contrast(state.primaryForeground, state.primaryBackground) >= 4.5);
      }
      await page.close();
    }
  }

  process.stdout.write(
    'Website locale, privacy, metadata, accessibility, image, and responsive smoke checks passed.\n'
  );
} finally {
  if (browser) await browser.close();
  if (server && !server.killed) server.kill('SIGTERM');
}
