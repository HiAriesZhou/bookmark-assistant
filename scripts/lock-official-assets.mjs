import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { ROOT } from './build-profile.mjs';

const root = resolve(
  process.env.BOOKMARK_ASSISTANT_OFFICIAL_ASSETS || resolve(ROOT, '.official-assets')
);
const path = resolve(root, 'assets.lock.json');
const lock = JSON.parse(await readFile(path, 'utf8'));
const files = {};
for (const file of Object.keys(lock.files).sort()) {
  const location = resolve(root, file);
  if (isAbsolute(file) || relative(root, location).startsWith('..'))
    throw new Error('Invalid asset path');
  files[file] = createHash('sha256')
    .update(await readFile(location))
    .digest('hex');
}
await writeFile(
  path,
  JSON.stringify(
    {
      ...lock,
      files,
      assetTreeSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    },
    null,
    2
  ) + '\n'
);
console.log('Recorded the reviewed official asset snapshot.');
