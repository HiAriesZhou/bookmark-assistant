import assert from 'node:assert/strict';
import test from 'node:test';
import policy from '../content/policy.json' with { type: 'json' };
import { access } from 'node:fs/promises';
import sharp from 'sharp';
import {
  APPROVED_STORE_ASSETS,
  DIMENSIONS,
  MARKETING_LOCALES,
  SCENES,
  loadContent,
} from '../src/config.mjs';
import { marqueeCanvas, screenshotCanvas } from '../src/canvas.mjs';

test('scene catalog matches policy and localized copy', async () => {
  assert.deepEqual(
    SCENES.map((scene) => scene.id),
    policy.requiredScreenshotIds
  );
  for (const locale of MARKETING_LOCALES) {
    const content = await loadContent(locale);
    assert.deepEqual(
      content.screenshots.map((scene) => scene.id),
      policy.requiredScreenshotIds
    );
  }
});

test('canvas templates preserve real image inputs and escape localized copy', () => {
  const html = screenshotCanvas({
    locale: 'en',
    copy: {
      productName: 'Bookmark Assistant',
      headline: '<Result>',
      body: 'A & B',
      planLabels: { pro: 'Pro' },
    },
    scene: SCENES[0],
    productImage: 'data:image/png;base64,product',
    logoImage: 'data:image/png;base64,logo',
  });
  assert.match(html, /data:image\/png;base64,product/);
  assert.match(html, /&lt;Result&gt;/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<Result>/);

  const marquee = marqueeCanvas({
    copy: {
      productName: 'Bookmark Assistant',
      headline: '<Save>. Keep it.',
      body: 'A & B',
      meta: 'Local',
      productHunt: '133 upvotes',
    },
    productImage: 'data:image/png;base64,product',
    logoImage: 'data:image/png;base64,logo',
  });
  assert.match(marquee, /&lt;Save&gt;\.<br>Keep it\./);
  assert.match(marquee, /A &amp; B/);
  assert.doesNotMatch(marquee, /<Save>/);
});

test('all required output dimensions are fixed positive integers', () => {
  for (const dimensions of Object.values(DIMENSIONS)) {
    assert.equal(Number.isInteger(dimensions.width), true);
    assert.equal(Number.isInteger(dimensions.height), true);
    assert.ok(dimensions.width > 0 && dimensions.height > 0);
  }
});

test('approved store assets exist at their required dimensions', async () => {
  const expected = [
    [APPROVED_STORE_ASSETS.storeIcon, DIMENSIONS.storeIcon],
    [APPROVED_STORE_ASSETS.smallPromo, DIMENSIONS.smallPromo],
    [APPROVED_STORE_ASSETS.marquee, DIMENSIONS.marquee],
  ];
  for (const [file, dimensions] of expected) {
    await access(file);
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, dimensions.width);
    assert.equal(metadata.height, dimensions.height);
  }
});
