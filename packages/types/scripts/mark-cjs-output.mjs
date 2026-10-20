import { writeFileSync } from 'node:fs';

// dist/cjs sits under a "type": "module" package; this marker makes Node load
// those files as CommonJS for require() consumers such as the server.
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{ "type": "commonjs" }\n');
