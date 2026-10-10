import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { resolveBuildConfig, brandFiles, ROOT } from './build-config.mjs';

/** Mirrors brand inputs into the ignored website public directory. */
export async function prepareBrandAssets(env = process.env, options = {}) {
  const config = resolveBuildConfig(env, options);
  const destination = join(ROOT, 'packages/website/public/product');
  await mkdir(destination, { recursive: true });
  for (const { source, target } of brandFiles(config)) {
    const output = join(destination, 'brand', target);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
  }
  const manifestPath = join(destination, 'brand/favicon/site.webmanifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = config.brand.name;
  manifest.short_name = config.brand.name;
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: `${config.publicAssetsPath}/brand/favicon/${basename(icon.src)}`,
  }));
  await writeFile(manifestPath, JSON.stringify(manifest));
  const presentation = join(ROOT, 'packages/website/public/assets');
  await mkdir(join(destination, 'assets'), { recursive: true });
  for (const file of ['chrome.svg', 'frost-grain.svg', 'laptop-en.png', 'laptop-zh-CN.png'])
    await copyFile(join(presentation, file), join(destination, 'assets', file));
  const og = join(ROOT, 'packages/marketing/assets/website/bookmark-assistant-og.png');
  await cp(og, join(destination, 'assets/bookmark-assistant-og.png'));
  console.log('Prepared website brand resources.');
  return config;
}

if (process.argv[1]?.endsWith('/prepare-brand-assets.mjs')) await prepareBrandAssets();
