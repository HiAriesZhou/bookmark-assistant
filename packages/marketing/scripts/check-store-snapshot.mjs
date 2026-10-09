import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { APPROVED_STORE_DIR, PACKAGE_DIR, REPO_ROOT } from '../src/config.mjs';
import { resolveBuildProfile } from '../../../scripts/build-profile.mjs';
const profile = resolveBuildProfile();
if (!profile.official) {
  console.log('Community builds do not require official store snapshots.');
  process.exit(0);
}

// packages/marketing/store is the per-release Chrome Web Store upload snapshot that
// DashBye syncs from. Its brand and promo images are copies, so they must never
// drift from the approved sources (decision 0006). Screenshots and listing text are
// release-specific and are pinned by the DashBye release lock instead.
const snapshotDir = join(profile.assetRoot, 'packages/marketing/store/assets');
const copies = [
  [
    join(profile.assetRoot, 'packages/shared/assets/brand/logo_128x128.png'),
    join(snapshotDir, 'icon-128.png'),
  ],
  [join(APPROVED_STORE_DIR, 'small-promo.png'), join(snapshotDir, 'promo/small-promo.png')],
  [join(APPROVED_STORE_DIR, 'marquee.png'), join(snapshotDir, 'promo/marquee.png')],
];

const failures = [];
for (const [source, target] of copies) {
  const [expected, actual] = await Promise.all(
    [source, target].map((file) => readFile(file).catch(() => null))
  );
  if (!expected || !actual || !expected.equals(actual)) {
    failures.push(`${relative(REPO_ROOT, target)} differs from ${relative(REPO_ROOT, source)}`);
  }
}
if (failures.length) {
  throw new Error(`Store snapshot has drifted from approved sources:\n- ${failures.join('\n- ')}`);
}
process.stdout.write('Store snapshot images match approved sources.\n');
