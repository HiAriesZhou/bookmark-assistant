import { describe, expect, it, vi } from 'vitest';
import { getMigrationPlan, runMigration } from './migrate-deploy.mjs';

describe('migrate-deploy', () => {
  it.each(['preview', 'development', undefined])(
    'skips Vercel %s deployments even when database URLs are present',
    (vercelEnv) => {
      expect(
        getMigrationPlan({
          VERCEL: '1',
          VERCEL_ENV: vercelEnv,
          DIRECT_URL: 'postgresql://direct.example/test',
          DATABASE_URL: 'postgresql://pooler.example/test',
        })
      ).toMatchObject({ action: 'skip' });
    }
  );

  it('requires DIRECT_URL for production Vercel migrations', () => {
    expect(
      getMigrationPlan({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        DATABASE_URL: 'postgresql://pooler.example/test',
      })
    ).toMatchObject({ action: 'error' });
  });

  it('deploys production Vercel migrations through DIRECT_URL', () => {
    expect(
      getMigrationPlan({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        DIRECT_URL: 'postgresql://direct.example/test',
        DATABASE_URL: 'postgresql://pooler.example/test',
      })
    ).toEqual({
      action: 'deploy',
      migrationUrl: 'postgresql://direct.example/test',
      source: 'DIRECT_URL',
    });
  });

  it('keeps explicit local migration commands available', () => {
    expect(getMigrationPlan({ DATABASE_URL: 'postgresql://local.example/test' })).toMatchObject({
      action: 'deploy',
      migrationUrl: 'postgresql://local.example/test',
      source: 'DATABASE_URL',
    });
  });

  it('does not spawn Prisma for preview deployments', () => {
    const spawn = vi.fn();
    const status = runMigration({
      env: {
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        DIRECT_URL: 'postgresql://direct.example/test',
      },
      spawn,
    });

    expect(status).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });
});
