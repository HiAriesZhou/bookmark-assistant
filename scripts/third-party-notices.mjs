import { existsSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT } from './build-profile.mjs';

function findPackage(name, from) {
  let directory = from;
  while (true) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function thirdPartyNotices(workspace = 'extension') {
  const root = resolve(ROOT, 'packages', workspace);
  const seen = new Set();
  const records = [];
  function visit(directory) {
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const identity = `${pkg.name}@${pkg.version}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    if (!pkg.name.startsWith('@bookmark-assistant/')) {
      const files = readdirSync(directory).filter((name) =>
        /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.|$)/i.test(name)
      );
      records.push(
        `${identity}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : 'See upstream license'}\n${pkg.homepage || ''}\n${files.map((file) => readFileSync(join(directory, file), 'utf8')).join('\n')}`
      );
      if (!files.length && !pkg.license)
        throw new Error(`Missing runtime license attribution: ${identity}`);
    }
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    })) {
      const dependency = findPackage(name, directory);
      if (dependency) visit(dependency);
    }
  }
  visit(root);
  return `Third-party components retain their own licenses.\n\n${records.sort().join('\n\n---\n\n')}\n`;
}
