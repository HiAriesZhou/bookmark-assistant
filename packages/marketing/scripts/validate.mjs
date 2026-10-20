import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import sharp from 'sharp';
import {
  DIMENSIONS,
  MARKETING_LOCALES,
  OUTPUT_DIR,
  SCENES,
  loadContent,
  loadProductVersion,
  screenshotFilename,
} from '../src/config.mjs';

const manifestPath = `${OUTPUT_DIR}/manifest.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function validateImage(relativePath, expected, expectedHash) {
  check(!isAbsolute(relativePath), `${relativePath} must be relative`);
  check(
    !normalize(relativePath).startsWith('..'),
    `${relativePath} escapes the generated directory`
  );
  const path = `${OUTPUT_DIR}/${relativePath}`;
  const data = await readFile(path);
  const metadata = await sharp(data).metadata();
  check(metadata.format === 'png', `${relativePath} must be PNG`);
  check(metadata.width === expected.width, `${relativePath} width must be ${expected.width}`);
  check(metadata.height === expected.height, `${relativePath} height must be ${expected.height}`);
  check(metadata.space === 'srgb', `${relativePath} must use sRGB`);
  if (relativePath.startsWith('screenshots/')) {
    check(!metadata.hasAlpha, `${relativePath} must not have an alpha channel`);
  }
  check(
    createHash('sha256').update(data).digest('hex') === expectedHash,
    `${relativePath} hash mismatch`
  );
}

check(manifest.schemaVersion === 2, 'manifest schemaVersion must be 2');
check(
  manifest.productVersion === (await loadProductVersion()),
  'manifest product version is stale'
);
check(manifest.syntheticFixturesOnly === true, 'manifest must assert synthetic fixtures only');
check(
  manifest.sourceBaseUrl === 'http://127.0.0.1:<local-port>',
  'only the local preview may be a source'
);
const expectedScreenshotCount = MARKETING_LOCALES.length * SCENES.length + 1;
check(
  manifest.screenshots?.length === expectedScreenshotCount,
  `exactly ${expectedScreenshotCount} screenshots are required`
);
check(manifest.assets?.length === 4, 'exactly four supporting assets are required');
check(manifest.candidates?.length === 1, 'exactly one store artwork candidate is required');

for (const locale of MARKETING_LOCALES) {
  const content = await loadContent(locale);
  check(content.screenshots.length === SCENES.length, `${locale} must define five screenshots`);
  for (const [index, scene] of SCENES.entries()) {
    const expectedFile = screenshotFilename(locale, index, scene.id).slice(OUTPUT_DIR.length + 1);
    const item = manifest.screenshots.find(
      (candidate) => candidate.locale === locale && candidate.id === scene.id
    );
    check(Boolean(item), `${locale}/${scene.id} is missing from the manifest`);
    if (item) {
      check(item.file === expectedFile, `${locale}/${scene.id} has an unexpected filename`);
      check(
        item.scenario === scene.scenario,
        `${locale}/${scene.id} uses the wrong product scenario`
      );
      await validateImage(item.file, DIMENSIONS.screenshot, item.sha256);
    }
  }
}

const overview = manifest.screenshots.find(
  (item) => item.locale === 'global' && item.id === 'overview'
);
check(Boolean(overview), 'Global overview screenshot is required');
if (overview) {
  check(overview.file === 'screenshots/global/01-overview.png', 'Unexpected global overview path');
  await validateImage(overview.file, DIMENSIONS.screenshot, overview.sha256);
}

const expectedAssets = new Map([
  ['store-icon', DIMENSIONS.storeIcon],
  ['small-promo', DIMENSIONS.smallPromo],
  ['marquee', DIMENSIONS.marquee],
  ['og-image', DIMENSIONS.og],
]);
for (const item of manifest.assets) {
  const dimensions = expectedAssets.get(item.id);
  check(Boolean(dimensions), `unexpected supporting asset ${item.id}`);
  if (dimensions) await validateImage(item.file, dimensions, item.sha256);
}
const marqueeCandidate = manifest.candidates?.find((item) => item.id === 'marquee');
if (marqueeCandidate) {
  check(marqueeCandidate.locale === 'en', 'marquee candidate must use English copy');
  await validateImage(marqueeCandidate.file, DIMENSIONS.marquee, marqueeCandidate.sha256);
}

const serialized = JSON.stringify(manifest).toLowerCase();
for (const forbidden of [
  'home.png',
  'notion.so/',
  'workspace_id',
  'database_id',
  'data_source_id',
  'chrome-extension://',
]) {
  check(
    !serialized.includes(forbidden),
    `generated manifest includes forbidden source marker: ${forbidden}`
  );
}

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Marketing assets are dimensionally valid, hashed, local-source-only, and synthetic-fixture-only.\n'
  );
}
