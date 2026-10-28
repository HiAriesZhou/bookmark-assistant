import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { marketingContentSchema, policySchema } from '../schemas/marketing-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('marketing locales share claims and screenshot order', () => {
  const policy = policySchema.parse(readJson(path.join(root, 'content/policy.json')));
  const copies = policy.marketingLocales.map((locale) =>
    marketingContentSchema.parse(readJson(path.join(root, `content/${locale}.json`)))
  );
  const signature = (copy) => ({
    released: copy.releasedClaims.map(({ id }) => id),
    gated: copy.featureGatedClaims.map(({ id }) => id),
    screenshots: copy.screenshots.map(({ id }) => id),
  });
  for (const copy of copies.slice(1)) assert.deepEqual(signature(copy), signature(copies[0]));
});

test('feature-gated screenshots always name a release gate', () => {
  const policy = policySchema.parse(readJson(path.join(root, 'content/policy.json')));
  for (const locale of policy.marketingLocales) {
    const copy = marketingContentSchema.parse(readJson(path.join(root, `content/${locale}.json`)));
    for (const screenshot of copy.screenshots) {
      if (screenshot.status === 'feature-gated') assert.ok(screenshot.gate);
    }
  }
});

test('website capability map covers canonical claims and keeps AI publication state aligned', () => {
  const policy = policySchema.parse(readJson(path.join(root, 'content/policy.json')));
  for (const locale of policy.marketingLocales) {
    const copy = marketingContentSchema.parse(readJson(path.join(root, `content/${locale}.json`)));
    assert.deepEqual(
      Object.keys(copy.website.capabilities).sort(),
      copy.releasedClaims.map(({ id }) => id).sort()
    );
    assert.equal(copy.website.capabilities['ai-organize'], copy.website.publication.ai);
  }
});

test('localized website structures stay in lockstep', () => {
  const policy = policySchema.parse(readJson(path.join(root, 'content/policy.json')));
  const copies = policy.marketingLocales.map((locale) =>
    marketingContentSchema.parse(readJson(path.join(root, `content/${locale}.json`)))
  );
  const signature = (copy) => ({
    capabilities: Object.keys(copy.website.capabilities),
    features: copy.website.features.items.map(({ status }) => status),
    steps: copy.website.how.steps.map(({ status }) => status),
    faq: copy.website.faq.items.map(({ status }) => status),
  });
  assert.deepEqual(signature(copies[1]), signature(copies[0]));
});
