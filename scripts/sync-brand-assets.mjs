import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveBuildProfile } from './build-profile.mjs';
import { prepareProfileAssets } from './prepare-profile-assets.mjs';

const profile = resolveBuildProfile();
if (process.argv.includes('--check')) {
  for (const asset of [
    ...Object.values(profile.brand.assets.logo),
    ...Object.values(profile.brand.assets.favicon),
  ]) {
    await access(resolve(profile.assetRoot, 'packages/shared', asset));
  }
  console.log(`${profile.profile} brand sources validated.`);
} else {
  await prepareProfileAssets();
}
