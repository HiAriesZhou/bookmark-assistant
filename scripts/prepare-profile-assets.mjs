import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { resolveBuildProfile, brandFiles, ROOT } from './build-profile.mjs';

export async function prepareProfileAssets(env = process.env) {
  const profile = resolveBuildProfile(env);
  const destination = join(ROOT, 'packages/website/public/product', profile.profile);
  await mkdir(destination, { recursive: true });
  for (const { source, target } of brandFiles(profile)) {
    const output = join(destination, 'brand', target);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
  }
  const manifestPath = join(destination, 'brand/favicon/site.webmanifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = profile.brand.name;
  manifest.short_name = profile.brand.name;
  manifest.icons = manifest.icons.map((icon) => ({
    ...icon,
    src: `${profile.publicAssetsPath}/brand/favicon/${basename(icon.src)}`,
  }));
  await writeFile(manifestPath, JSON.stringify(manifest));
  const presentation = join(profile.assetRoot, 'packages/website/public/assets');
  await mkdir(join(destination, 'assets'), { recursive: true });
  for (const file of ['chrome.svg', 'frost-grain.svg', 'laptop-en.png', 'laptop-zh-CN.png'])
    await copyFile(join(presentation, file), join(destination, 'assets', file));
  const og = join(profile.assetRoot, 'packages/marketing/assets/website/bookmark-assistant-og.png');
  await cp(og, join(destination, 'assets/bookmark-assistant-og.png'));
  if (profile.official)
    await cp(
      join(
        profile.assetRoot,
        'packages/website/public/apple-developer-merchantid-domain-association'
      ),
      join(destination, 'apple-developer-merchantid-domain-association')
    );
  // These generated files are namespaced and ignored; profile switches never edit sources.
  const content = Object.fromEntries(
    await Promise.all(
      ['en', 'zh-CN'].map(async (locale) => {
        const copy = JSON.parse(
          await readFile(join(profile.contentRoot, `${locale}.json`), 'utf8')
        );
        return [
          locale,
          {
            productName: profile.brand.name,
            ctas: copy.ctas,
            planLabels: copy.planLabels,
            ...copy.website,
          },
        ];
      })
    )
  );
  const module = join(ROOT, 'packages/website/.product', profile.profile, 'marketing-copy.json');
  await mkdir(dirname(module), { recursive: true });
  await writeFile(module, JSON.stringify(content));
  console.log(`Prepared ${profile.profile} build resources.`);
  return profile;
}

if (process.argv[1]?.endsWith('/prepare-profile-assets.mjs')) await prepareProfileAssets();
