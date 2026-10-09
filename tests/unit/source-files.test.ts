import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared build tooling is ESM.
import { sourceFiles } from '../../scripts/check-open-source.mjs';

describe('source snapshot inputs', () => {
  it.each(['no-git', 'untracked', 'tracked'])('%s excludes its own packaging manifest', (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'ba-source-inputs-'));
    try {
      writeFileSync(join(directory, 'example.ts'), 'export const example = true;\n');
      writeFileSync(join(directory, 'source-manifest.json'), '{}\n');
      if (mode !== 'no-git') {
        execFileSync('git', ['init', '--quiet'], { cwd: directory });
        if (mode === 'tracked') execFileSync('git', ['add', '.'], { cwd: directory });
      }
      expect(sourceFiles(directory)).toEqual(['example.ts']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
