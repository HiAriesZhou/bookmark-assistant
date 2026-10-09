/** One-time recoverable migration: copies approved assets before removing source copies. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { ROOT } from './build-profile.mjs';

const paths = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
  .toString()
  .split('\0')
  .filter(Boolean);
const selected = paths.filter(
  (file) =>
    /^(packages\/shared\/(assets\/brand\/|brand\.json)|packages\/extension\/src\/assets\/|packages\/marketing\/(assets\/|store\/|content\/)|packages\/website\/public\/)/.test(
      file
    ) || file === 'dashbye.config.yml'
);
const archive = join(ROOT, '.official-assets');
const checksums = {};
for (const file of selected) {
  const source = join(ROOT, file);
  const destination = join(archive, file);
  const bytes = await readFile(source);
  try {
    if (!(await readFile(destination)).equals(bytes))
      throw new Error(`Archive already contains different bytes: ${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  checksums[file] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(
  join(archive, 'assets.lock.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      codeRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(),
      files: checksums,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `Archived and verified ${selected.length} files in the ignored private asset workspace.`
);
