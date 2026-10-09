import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './build-profile.mjs';

export function sourceFiles(root = ROOT) {
  if (!existsSync(join(root, '.git'))) {
    const excluded =
      /^(?:\.git|\.official-assets|\.build|\.product|\.next.*|\.vercel|node_modules|dist.*|generated|test-results|playwright-report|coverage|\.cache|\.pnpm-store)$/;
    function walk(directory = '') {
      return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
        const file = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) return [];
        if (entry.isDirectory())
          return excluded.test(entry.name) || file === 'packages/website/public/product'
            ? []
            : walk(file);
        return entry.name === 'source-manifest.json' ||
          /(?:\.tsbuildinfo|\.log|\.zip)$/.test(entry.name) ||
          entry.name === '.DS_Store' ||
          (entry.name.startsWith('.env') && entry.name !== '.env.example')
          ? []
          : [file];
      });
    }
    return walk().sort();
  }
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
      })
        .toString()
        .split('\0')
        .filter(Boolean)
    ),
  ].filter((file) => file !== 'source-manifest.json' && existsSync(join(root, file)));
}

export function checkSource(files = sourceFiles()) {
  const violations = [];
  const forbidden =
    /(^|\/)(\.git|\.official-assets|\.vercel|node_modules|docs|generated|dist[^/]*|\.next[^/]*|test-results|playwright-report)(\/|$)|\.(?:pem|key|zip|log|sqlite|db)$/;
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
  ];
  for (const file of files) {
    if (
      forbidden.test(file) ||
      (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'))
    )
      violations.push({ file, reason: 'private or generated path' });
    if (/\.(?:ts|tsx|js|mjs|json|md|ya?ml|sh|txt)$/.test(file) || file.endsWith('.env.example')) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      if (patterns.some((pattern) => pattern.test(text)))
        violations.push({ file, reason: 'potential secret; value redacted' });
    }
  }
  if (violations.length) throw new Error(JSON.stringify(violations));
  for (const file of [
    'package.json',
    ...files.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file)),
  ]) {
    if (JSON.parse(readFileSync(join(ROOT, file), 'utf8')).license !== 'GPL-3.0-only')
      throw new Error(`Inconsistent project license: ${file}`);
  }
  console.log(
    `Public source guard passed for ${files.length} files. Run the independent secret and provenance audit before publication.`
  );
}
if (process.argv[1]?.endsWith('/check-open-source.mjs')) checkSource();
