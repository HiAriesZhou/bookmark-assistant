import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './build-config.mjs';
// Dependency metadata is a review aid, not proof that unknown/custom licenses are GPL compatible.
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const report = execFileSync(command, ['licenses', 'list', '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
await mkdir(join(ROOT, '.build'), { recursive: true });
await writeFile(join(ROOT, '.build', 'dependency-licenses.json'), report);
console.log('Wrote installed dependency license metadata to .build/dependency-licenses.json.');
