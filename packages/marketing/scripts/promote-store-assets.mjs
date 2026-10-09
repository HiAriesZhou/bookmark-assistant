import { copyFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { APPROVED_STORE_ASSETS, CANDIDATE_STORE_DIR, DIMENSIONS } from '../src/config.mjs';

const candidate = `${CANDIDATE_STORE_DIR}/marquee.png`;
const metadata = await sharp(candidate).metadata();
if (
  metadata.format !== 'png' ||
  metadata.width !== DIMENSIONS.marquee.width ||
  metadata.height !== DIMENSIONS.marquee.height
) {
  throw new Error('Marquee candidate must be a 1400×560 PNG.');
}

await mkdir(new URL('../assets/store/', import.meta.url), { recursive: true });
await copyFile(candidate, APPROVED_STORE_ASSETS.marquee);
process.stdout.write('Promoted the reviewed English Marquee into assets/store/marquee.png.\n');
