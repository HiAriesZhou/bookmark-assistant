import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import {
  existsSync,
  cpSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
} from 'fs';
import { resolve, dirname } from 'path';
import { createPublicKey } from 'node:crypto';
// @ts-expect-error Shared executable build configuration is plain ESM.
import { resolveBuildConfig, brandFiles } from '../../scripts/build-config.mjs';
// @ts-expect-error License inventory is shared executable ESM.
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs';
// @ts-expect-error Shared source fingerprint tooling is ESM.
import { sourceFingerprint } from '../../scripts/source-fingerprint.mjs';

export default defineConfig(({ mode }) => {
  const development = mode !== 'production';
  const config = resolveBuildConfig(
    development ? { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env } : process.env,
    { development }
  );
  const PRODUCT_VERSION = JSON.parse(readFileSync(resolve('../../package.json'), 'utf8')).version;
  const distDir = development ? 'dist-dev' : 'dist';
  const envDir = process.env.BOOKMARK_ASSISTANT_ENV_DIR;

  return {
    ...(envDir ? { envDir } : {}),
    plugins: [
      react(),
      // Custom plugin to handle Chrome extension build
      {
        name: 'chrome-extension-build',
        transformIndexHtml(html) {
          const branded = html.replace(/Bookmark Assistant(?: Pro)?/g, config.brand.name);
          return mode === 'production'
            ? branded
            : branded.replace('/assets/logo.png', `/@fs/${config.brandRoot}/logo.png`);
        },
        writeBundle() {
          // Copy manifest.json first
          const manifestSrc = resolve('public/manifest.json');
          const manifestDst = resolve(distDir, 'manifest.json');
          if (existsSync(manifestSrc)) {
            copyFileSync(manifestSrc, manifestDst);
            copyFileSync(resolve('../../LICENSE'), resolve(distDir, 'LICENSE.txt'));
            writeFileSync(
              resolve(distDir, 'THIRD_PARTY_NOTICES.txt'),
              thirdPartyNotices('extension')
            );
            writeFileSync(
              resolve(distDir, 'BUILD_INFO.json'),
              JSON.stringify(
                {
                  version: PRODUCT_VERSION,
                  officialBuild: config.officialBuild,
                  sourceTreeSha256: sourceFingerprint().sourceTreeSha256,
                  publicConfig: config.publicEnv,
                },
                null,
                2
              )
            );
          }
          const optionsSrc = resolve(distDir, 'src/options/options.html');
          const optionsDst = resolve(distDir, 'options.html');
          if (existsSync(optionsSrc)) {
            copyFileSync(optionsSrc, optionsDst);
          }
          const popupSrc = resolve(distDir, 'src/popup/popup.html');
          const popupDst = resolve(distDir, 'popup.html');
          if (existsSync(popupSrc)) {
            copyFileSync(popupSrc, popupDst);
          }
          // Copy declared resources only, never an entire private asset directory.
          for (const { source, target } of brandFiles(config)) {
            const output = resolve(distDir, 'assets', target);
            mkdirSync(dirname(output), { recursive: true });
            copyFileSync(source, output);
          }
          // Copy _locales directory for i18n support. marketing:copy:check keeps the
          // store-facing messages aligned with packages/marketing/content.
          const localesDir = resolve('_locales');
          if (existsSync(localesDir)) {
            cpSync(localesDir, resolve(distDir, '_locales'), { recursive: true });
          }
          // Rename background script to match manifest
          const bgAssetsDir = resolve(distDir, 'assets');
          const bgFiles = readdirSync(bgAssetsDir).filter((f) => f.startsWith('background-'));
          if (bgFiles.length > 0) {
            const bgFile = bgFiles[0];
            const bgSrc = resolve(bgAssetsDir, bgFile);
            const bgDst = resolve(bgAssetsDir, 'background.js');
            renameSync(bgSrc, bgDst);
          }
          // Verify manifest was copied correctly
          try {
            const manifestContent = readFileSync(manifestDst, 'utf-8');
            const manifest = JSON.parse(manifestContent);
            if (mode !== 'production') manifest.name = `${config.brand.name} (Development)`;
            if (process.env.BOOKMARK_ASSISTANT_EXTENSION_PUBLIC_KEY) {
              createPublicKey({
                key: Buffer.from(process.env.BOOKMARK_ASSISTANT_EXTENSION_PUBLIC_KEY, 'base64'),
                format: 'der',
                type: 'spki',
              });
              manifest.key = process.env.BOOKMARK_ASSISTANT_EXTENSION_PUBLIC_KEY;
            }
            // The API allows the extension origin through CORS, so no host permission
            // (and no install-time warning that would disable existing installs) is needed.
            manifest.host_permissions = [];
            manifest.action.default_icon['128'] = 'assets/logo_128x128.png';
            manifest.icons['128'] = 'assets/logo_128x128.png';
            manifest.version = PRODUCT_VERSION;
            if (!manifest.default_locale) {
              console.error('WARNING: default_locale missing in manifest, fixing...');
              manifest.default_locale = 'en';
            }
            writeFileSync(manifestDst, JSON.stringify(manifest, null, 2));
          } catch (e) {
            throw e;
          }
        },
      },
    ],
    css: {
      postcss: {
        plugins: [tailwindcss, autoprefixer],
      },
    },
    // Keep local and release artifacts isolated so Chrome can load both safely.
    build: {
      outDir: distDir,
      rollupOptions: {
        input: {
          options: 'src/options/options.html',
          popup: 'src/popup/popup.html',
          background: 'src/background/index.ts',
        },
      },
      copyPublicDir: true,
      target: 'es2017',
      minify: 'terser',
      terserOptions: {
        compress: {
          // Browser-console diagnostics are useful in development but must not
          // be shipped in the Web Store artifact.
          drop_console: mode === 'production',
          drop_debugger: true,
        },
      },
    },
    define: {
      // Clean defines - no window polyfills needed
      global: 'globalThis',
      ...Object.fromEntries(
        Object.entries(config.publicEnv).map(([key, value]) => [
          `import.meta.env.${key}`,
          JSON.stringify(value),
        ])
      ),
    },
    resolve: {
      alias: {
        '@product-logo': resolve(config.brandRoot, 'logo.png'),
        '@bookmark-assistant/types': resolve('../types/src/index.ts'),
      },
    },
  };
});
