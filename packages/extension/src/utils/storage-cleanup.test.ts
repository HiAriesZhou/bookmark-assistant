import { afterEach, expect, it, vi } from 'vitest';
import { cleanupStorage } from './storage-cleanup';

afterEach(() => vi.unstubAllGlobals());

it('removes retired caches and refresh flags while preserving local edits and account ownership', async () => {
  const metadata = {
    schemaVersion: 1,
    byBookmarkId: {
      'bookmark-1': {
        description: 'User summary',
        tags: ['Reference'],
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
    },
  };
  const preserved = {
    bookmark_library_metadata_v1: metadata,
    cached_pricing: { monthly: 1.5, yearly: 15, schemaVersion: 2 },
    session_token: 'synthetic-session',
    account_state_revision: 'synthetic-revision',
    last_sync_fingerprint: 'synthetic-fingerprint',
    sync_enrichment_job: { id: 'pending', items: [] },
    page_description_cache_backup: 'unrelated key',
  };
  const values: Record<string, unknown> = {
    ...preserved,
    is_refreshing_entitlements: true,
    page_description_cache: {
      'https://example.com/legacy': { description: 'Old automatic description', timestamp: 1 },
    },
  };
  const remove = vi.fn(async (keys: string[]) => {
    for (const key of keys) delete values[key];
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...values })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(values, patch)),
        remove,
      },
    },
  });

  await cleanupStorage();

  expect(remove).toHaveBeenCalledExactlyOnceWith([
    'page_description_cache',
    'is_refreshing_entitlements',
  ]);
  expect(values).toEqual(preserved);

  await cleanupStorage();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(values).toEqual(preserved);
});
