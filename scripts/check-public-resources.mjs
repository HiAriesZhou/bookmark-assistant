import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './build-config.mjs';
for (const file of [
  'packages/marketing/assets/store/small-promo.png',
  'packages/marketing/assets/store/marquee.png',
  'packages/marketing/assets/website/bookmark-assistant-og.png',
  'packages/website/public/assets/laptop-en.png',
  'packages/website/public/assets/laptop-zh-CN.png',
])
  await access(join(ROOT, file));
await import('../packages/marketing/scripts/check-store-snapshot.mjs');
console.log('Public resources validated without generated mirrors.');
