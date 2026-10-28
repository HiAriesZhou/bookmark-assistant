import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import en from '../../_locales/en/messages.json';
import zh from '../../_locales/zh_CN/messages.json';

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('defines every literal message key in both locales', () => {
  const keys = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) {
      keys.add(match[1]);
    }
  }
  // The documentation example in utils/i18n.ts is not a real key.
  keys.delete('key_name');

  expect([...keys].filter((key) => !(key in en))).toEqual([]);
  expect([...keys].filter((key) => !(key in zh))).toEqual([]);
});
