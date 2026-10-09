import { spawn } from 'node:child_process';
import { runMigration } from './migrate-deploy.mjs';

if (process.env.SELF_HOSTED !== 'true')
  throw new Error('This entry point requires SELF_HOSTED=true.');
const status = runMigration();
if (status !== 0) process.exit(status);
const server = spawn(process.execPath, ['dist/index.js'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('error', () => {
  console.error('Could not start the server.');
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
