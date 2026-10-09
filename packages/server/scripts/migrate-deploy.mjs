import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function getMigrationPlan(env = process.env) {
  const directUrl = env.DIRECT_URL?.trim();
  const runtimeUrl = env.DATABASE_URL?.trim();
  const migrationUrl = directUrl || runtimeUrl;

  if (env.VERCEL && env.VERCEL_ENV !== 'production') {
    return {
      action: 'skip',
      message: `[Prisma] Skipping migrations for Vercel ${env.VERCEL_ENV || 'unknown'} deployment.`,
    };
  }

  if (env.VERCEL && !directUrl) {
    return {
      action: 'error',
      message:
        '[Prisma] DIRECT_URL is required on Vercel so migrations do not use the transaction pooler.',
    };
  }

  if (!migrationUrl) {
    return {
      action: 'error',
      message: '[Prisma] DATABASE_URL or DIRECT_URL is required to deploy migrations.',
    };
  }

  return {
    action: 'deploy',
    migrationUrl,
    source: directUrl ? 'DIRECT_URL' : 'DATABASE_URL',
  };
}

export function runMigration({ env = process.env, cwd = process.cwd(), spawn = spawnSync } = {}) {
  const plan = getMigrationPlan(env);
  if (plan.action === 'skip') {
    console.log(plan.message);
    return 0;
  }
  if (plan.action === 'error') {
    console.error(plan.message);
    return 1;
  }

  console.log(`[Prisma] Deploying pending migrations using ${plan.source}.`);
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawn(command, ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd,
    env: {
      ...env,
      DATABASE_URL: plan.migrationUrl,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    console.error('[Prisma] Failed to start migrate deploy:', result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = runMigration();
}
