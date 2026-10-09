import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { sourceFiles } from './check-open-source.mjs';
import { ROOT } from './build-profile.mjs';

export function sourceFingerprint() {
  const files = Object.fromEntries(
    sourceFiles()
      .sort()
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(join(ROOT, file)))
          .digest('hex'),
      ])
  );
  return {
    sourceTreeSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files,
  };
}
