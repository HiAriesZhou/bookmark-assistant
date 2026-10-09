import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBuildProfile } from './build-profile.mjs';
const profile = resolveBuildProfile();
for (const file of [
  'packages/marketing/assets/store/small-promo.png',
  'packages/marketing/assets/store/marquee.png',
  'packages/marketing/assets/website/bookmark-assistant-og.png',
  'packages/website/public/assets/laptop-en.png',
  'packages/website/public/assets/laptop-zh-CN.png',
])
  await access(join(profile.assetRoot, file));
if (profile.official) await import('../packages/marketing/scripts/check-store-snapshot.mjs');
console.log(`${profile.profile} resources validated without generated mirrors.`);
