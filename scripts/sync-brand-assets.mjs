import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveBuildConfig, ROOT } from './build-config.mjs';
import { prepareBrandAssets } from './prepare-brand-assets.mjs';

if (process.argv.includes('--check')) {
  const { brand } = resolveBuildConfig();
  for (const asset of [...Object.values(brand.assets.logo), ...Object.values(brand.assets.favicon)])
    await access(resolve(ROOT, 'packages/shared', asset));
  console.log('Brand sources validated.');
} else {
  await prepareBrandAssets();
}
