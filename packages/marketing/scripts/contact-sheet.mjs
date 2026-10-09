import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  DIMENSIONS,
  MARKETING_LOCALES,
  REVIEW_DIR,
  SCENES,
  screenshotFilename,
} from '../src/config.mjs';

await mkdir(REVIEW_DIR, { recursive: true });

const composites = [];
const tileWidth = 360;
const tileHeight = 225;
const startX = 40;
const startY = 86;
const columnGap = 28;
const rowGap = 150;

for (const [row, locale] of MARKETING_LOCALES.entries()) {
  for (const [column, scene] of SCENES.entries()) {
    const input = await sharp(screenshotFilename(locale, column, scene.id))
      .resize(tileWidth, tileHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    const left = startX + column * (tileWidth + columnGap);
    const top = startY + row * (tileHeight + rowGap);
    composites.push({ input, left, top });
    const label =
      Buffer.from(`<svg width="${tileWidth}" height="42" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="8" fill="#1c3128"/>
      <text x="14" y="27" fill="#e8f2eb" font-family="Arial, sans-serif" font-size="16" font-weight="700">${locale} · ${column + 1} · ${scene.id}</text>
    </svg>`);
    composites.push({ input: label, left, top: top + tileHeight + 12 });
  }
}

await sharp({
  create: {
    width: DIMENSIONS.contactSheet.width,
    height: DIMENSIONS.contactSheet.height,
    channels: 3,
    background: '#eef2ec',
  },
})
  .composite(composites)
  .png()
  .toFile(`${REVIEW_DIR}/contact-sheet.png`);

process.stdout.write(
  `Created the ${MARKETING_LOCALES.length * SCENES.length}-scene contact sheet.\n`
);
