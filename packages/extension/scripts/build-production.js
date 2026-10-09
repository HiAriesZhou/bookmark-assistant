#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildProfile } from '../../../scripts/build-profile.mjs';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = resolveBuildProfile();
const envDirectory = mkdtempSync(join(tmpdir(), `link-library-${profile.profile}-env-`));
try {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_'))
  );
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      'build',
      '--mode',
      'production',
    ],
    {
      cwd,
      stdio: 'inherit',
      env: { ...env, ...profile.publicEnv, BOOKMARK_ASSISTANT_ENV_DIR: envDirectory },
    }
  );
} finally {
  rmSync(envDirectory, { recursive: true, force: true });
}
