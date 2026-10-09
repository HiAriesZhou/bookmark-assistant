import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { ROOT } from './build-profile.mjs';
import { sourceFiles, checkSource } from './check-open-source.mjs';

const files = sourceFiles().sort();
checkSource(files);
const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const destination = resolve(process.argv[2] || join(ROOT, '.build', `public-source-${version}`));
// Export only to a new destination. Never overwrite another checkout or snapshot.
try {
  await access(destination);
  throw new Error('Snapshot destination exists; choose a new path.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination, { recursive: true });
const checksums = {};
for (const file of files) {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(ROOT, file), target);
  checksums[file] = createHash('sha256')
    .update(await readFile(target))
    .digest('hex');
}
await writeFile(
  join(destination, 'source-manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      version,
      sourceTreeSha256: createHash('sha256').update(JSON.stringify(checksums)).digest('hex'),
      workingTreeChanges: !!execFileSync('git', ['status', '--porcelain'], { cwd: ROOT })
        .toString()
        .trim(),
      files: checksums,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `Created a history-free source candidate at ${destination}. It contains no .git directory or private asset workspace.`
);
