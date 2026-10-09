import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  OUTPUT_DIR,
  PACKAGE_DIR,
  PACKAGE_OUTPUT_DIR,
  PROMO_DIR,
  SCREENSHOT_DIR,
  MARKETING_LOCALES,
} from '../src/config.mjs';

const run = promisify(execFile);
const zipPath = `${OUTPUT_DIR}/bookmark-assistant-chrome-web-store-assets.zip`;

await rm(PACKAGE_OUTPUT_DIR, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(PACKAGE_OUTPUT_DIR, { recursive: true });
await mkdir(`${PACKAGE_OUTPUT_DIR}/review`, { recursive: true });
await mkdir(`${PACKAGE_OUTPUT_DIR}/store-copy`, { recursive: true });
await Promise.all([
  cp(SCREENSHOT_DIR, `${PACKAGE_OUTPUT_DIR}/screenshots`, { recursive: true }),
  cp(PROMO_DIR, `${PACKAGE_OUTPUT_DIR}/promo`, { recursive: true }),
  ...MARKETING_LOCALES.map((locale) =>
    cp(`${PACKAGE_DIR}/store-copy/${locale}.md`, `${PACKAGE_OUTPUT_DIR}/store-copy/${locale}.md`)
  ),
  cp(`${OUTPUT_DIR}/review/contact-sheet.png`, `${PACKAGE_OUTPUT_DIR}/review/contact-sheet.png`, {
    recursive: true,
  }),
]);

const renderManifest = JSON.parse(await readFile(`${OUTPUT_DIR}/manifest.json`, 'utf8'));
await writeFile(
  `${PACKAGE_OUTPUT_DIR}/UPLOAD_CHECKLIST.txt`,
  [
    `Bookmark Assistant ${renderManifest.productVersion} Chrome Web Store review package`,
    '',
    'Manual gates before upload:',
    `1. Confirm the extension ZIP version is ${renderManifest.productVersion}.`,
    '2. Review review/contact-sheet.png at 100% scale.',
    '3. Verify English and Simplified Chinese listing copy in the store console.',
    '4. Confirm Pro appears only on the auto-sync screenshot.',
    '5. Upload manually. This package never publishes or changes store state.',
    '',
    'Screenshot upload mapping (keep all three sections populated):',
    'English Localized screenshots: screenshots/en/01 through 05.',
    'Simplified Chinese Localized screenshots: screenshots/zh-CN/01 through 05.',
    'Global screenshots (shared across languages): screenshots/global/01-overview.png.',
    '',
    `Fixture time: ${renderManifest.frozenTime}`,
    'All rendered product data is synthetic.',
  ].join('\n') + '\n'
);
await writeFile(
  `${PACKAGE_OUTPUT_DIR}/upload-manifest.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      productVersion: renderManifest.productVersion,
      reviewRequired: true,
      automaticPublishingAllowed: false,
      featureGates: [],
      screenshots: renderManifest.screenshots,
      promo: renderManifest.assets.filter((asset) => asset.file.startsWith('promo/')),
    },
    null,
    2
  )}\n`
);

await run('zip', ['-r', '-X', zipPath, '.'], { cwd: PACKAGE_OUTPUT_DIR });
process.stdout.write(`Created ${zipPath}. Upload remains a manual action.\n`);
