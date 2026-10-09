import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { APPROVED_WEBSITE_ASSETS, OUTPUT_DIR } from '../src/config.mjs';

const copies = [[`${OUTPUT_DIR}/website/og.png`, APPROVED_WEBSITE_ASSETS.og]];

for (const [source, target] of copies) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

process.stdout.write('Promoted reviewed website images into packages/marketing/assets/website.\n');
