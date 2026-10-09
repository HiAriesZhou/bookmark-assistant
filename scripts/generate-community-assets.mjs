import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from './build-profile.mjs';
const require = createRequire(new URL('../packages/marketing/package.json', import.meta.url));
const sharp = require('sharp');
const master = await readFile(join(ROOT, 'packages/shared/assets/community/library.svg'));
const brand = join(ROOT, 'packages/shared/assets/brand');
await mkdir(join(brand, 'favicon'), { recursive: true });
const outputs = new Map();
for (const size of [16, 32, 48, 64, 128, 180, 192, 512])
  outputs.set(size, await sharp(master).resize(size, size).png().toBuffer());
for (const size of [16, 32, 48, 64])
  await writeFile(join(brand, `favicon/favicon-${size}x${size}.png`), outputs.get(size));
for (const [name, size] of [
  ['logo.png', 512],
  ['logo_128x128.png', 128],
  ['library-master.png', 512],
  ['favicon/apple-touch-icon.png', 180],
  ['favicon/android-chrome-192x192.png', 192],
  ['favicon/android-chrome-512x512.png', 512],
])
  await writeFile(join(brand, name), outputs.get(size));
const header = Buffer.alloc(6 + 16 * 3);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(3, 4);
let offset = header.length;
const frames = [16, 32, 48].map((size, i) => {
  const frame = outputs.get(size);
  const entry = 6 + 16 * i;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
  return frame;
});
await writeFile(join(brand, 'favicon/favicon.ico'), Buffer.concat([header, ...frames]));
await writeFile(
  join(brand, 'favicon/site.webmanifest'),
  JSON.stringify({
    name: 'Link Library',
    short_name: 'Library',
    icons: [
      { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    display: 'standalone',
  })
);
const svg = (width, height) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f4f5f6"/><g fill="#20252b" font-family="sans-serif"><text x="8%" y="24%" font-size="${width / 25}">Link Library</text><text x="8%" y="37%" font-size="${width / 45}">Local bookmarks · Optional Notion sync · AI summaries and tags</text></g>${[0, 1, 2, 3].map((i) => `<rect x="8%" y="${48 + i * 10}%" width="84%" height="7%" rx="8" fill="${i ? '#e4e7eb' : '#d6dce3'}"/>`).join('')}</svg>`
  );
for (const [file, width, height] of [
  ['packages/marketing/assets/store/small-promo.png', 440, 280],
  ['packages/marketing/assets/store/marquee.png', 1400, 560],
  ['packages/marketing/assets/website/bookmark-assistant-og.png', 1200, 630],
  ['packages/website/public/assets/laptop-en.png', 1536, 1024],
  ['packages/website/public/assets/laptop-zh-CN.png', 1536, 1024],
]) {
  await mkdir(join(ROOT, dirnameOf(file)), { recursive: true });
  await writeFile(join(ROOT, file), await sharp(svg(width, height)).png().toBuffer());
}
function dirnameOf(file) {
  return file.slice(0, file.lastIndexOf('/'));
}
console.log(
  'Generated original GPL community images; official artwork remains in the private archive.'
);
