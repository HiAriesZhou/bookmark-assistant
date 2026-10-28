import { afterEach, expect, it, vi } from 'vitest';
import { cleanupStorage } from './storage-cleanup';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(values: Record<string, unknown>) {
  const remove = vi.fn(async (keys: string[]) => {
    for (const key of keys) delete values[key];
  });
  const set = vi.fn(async (patch: Record<string, unknown>) => Object.assign(values, patch));
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ ...values })), set, remove } },
  });
  return { remove, set };
}

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

it('removes account, plan and server keys by exact name and keeps local data', async () => {
  const preserved = {
    bookmark_library_metadata_v1: metadata,
    notion_token: 'synthetic-token',
    notion_database: { id: 'db-1' },
    destination_revision: 'revision-1',
    last_sync_fingerprint: 'synthetic-fingerprint',
    auto_sync_enabled: true,
    page_description_cache_backup: 'unrelated key',
  };
  const values: Record<string, unknown> = {
    ...preserved,
    session_token: 'synthetic-session',
    user_id: 'user-1',
    user_email: 'user@example.invalid',
    is_pro: true,
    purchase_type: 'monthly',
    subscription_source: 'paddle',
    subscription_expires_at: '2026-12-01T00:00:00.000Z',
    entitlements_cached_at: 1,
    deployment_profile: { deploymentMode: 'hosted' },
    account_created_notice: true,
    has_google_sign_in: true,
    account_state_revision: 'account-revision',
    cached_pricing: { monthly: 1.5 },
    oauth_template_database_id: 'template',
    is_connecting: false,
    sync_enrichment_job: { id: 'pending', items: [] },
    sync_enrichment_state: { status: 'idle' },
    last_bulk_sync: 1,
    last_sync_results: [],
    error_reports: [{ message: 'old' }],
    last_sync_hash: 'legacy-hash',
    page_description_cache: { 'https://example.com/legacy': { description: 'Old' } },
  };
  const { remove, set } = stubStorage(values);

  await cleanupStorage();

  expect(values).toEqual(preserved);
  expect(set).not.toHaveBeenCalled();

  await cleanupStorage();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('asks a user who connected Notion through the old service to reconnect with a token', async () => {
  const values: Record<string, unknown> = {
    session_token: 'synthetic-session',
    notion_connected: true,
  };
  stubStorage(values);

  await cleanupStorage();

  expect(values).toEqual({ notion_reconnect_notice: true });
});

it('does not ask for a reconnect once a token connection exists', async () => {
  const values: Record<string, unknown> = {
    notion_connected: true,
    notion_token: 'synthetic-token',
    notion_database: { id: 'db-1' },
  };
  stubStorage(values);

  await cleanupStorage();

  expect(values).toEqual({ notion_token: 'synthetic-token', notion_database: { id: 'db-1' } });
});
