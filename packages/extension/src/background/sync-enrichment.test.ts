import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enrichBookmarks } = vi.hoisted(() => ({ enrichBookmarks: vi.fn() }));
vi.mock('./server-api', () => ({ serverAPI: { enrichBookmarks } }));

import {
  enqueueSyncEnrichment,
  processPendingSyncEnrichment,
  SYNC_ENRICHMENT_ALARM,
  SYNC_ENRICHMENT_JOB_KEY,
  SYNC_ENRICHMENT_STATE_KEY,
} from './sync-enrichment';

const item = {
  title: 'Example',
  url: 'https://example.com',
  syncId: 'bookmark-1',
  notionPageId: 'page-1',
  action: 'created' as const,
  source: 'chrome_bookmark' as const,
};

describe('deferred sync enrichment', () => {
  let values: Record<string, unknown>;
  const createAlarm = vi.fn();
  const clearAlarm = vi.fn();

  beforeEach(() => {
    values = {};
    enrichBookmarks.mockReset();
    createAlarm.mockReset();
    clearAlarm.mockReset();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: values[key] })),
          set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(values, patch)),
          remove: vi.fn(async (key: string) => {
            delete values[key];
          }),
        },
      },
      alarms: {
        create: createAlarm,
        clear: clearAlarm,
        onAlarm: { addListener: vi.fn() },
      },
    } as unknown as typeof chrome;
  });

  it('persists work before processing and records completion separately from base sync', async () => {
    enrichBookmarks.mockResolvedValue({
      summary: { total: 1, generated: 1, alreadyPresent: 0, unavailable: 0, failed: 0 },
      aiPlanning: { status: 'planned', taskCount: 1 },
    });

    await enqueueSyncEnrichment({ items: [item], aiBatchEligible: true });
    await processPendingSyncEnrichment();

    expect(enrichBookmarks).toHaveBeenCalledWith({ items: [item], aiBatchEligible: true });
    expect(values[SYNC_ENRICHMENT_JOB_KEY]).toBeUndefined();
    expect(values[SYNC_ENRICHMENT_STATE_KEY]).toMatchObject({
      status: 'completed',
      total: 1,
      generated: 1,
      aiPlanning: { status: 'planned', taskCount: 1 },
    });
    expect(clearAlarm).toHaveBeenCalledWith(SYNC_ENRICHMENT_ALARM);
  });

  it('keeps failed work durable and schedules a bounded retry', async () => {
    enrichBookmarks.mockRejectedValue(new Error('temporary network failure'));

    await enqueueSyncEnrichment({ items: [item] });
    await processPendingSyncEnrichment();

    expect(values[SYNC_ENRICHMENT_JOB_KEY]).toMatchObject({ attempts: 1, items: [item] });
    expect(values[SYNC_ENRICHMENT_STATE_KEY]).toMatchObject({
      status: 'retrying',
      total: 1,
      lastError: 'temporary network failure',
    });
    expect(createAlarm).toHaveBeenCalledWith(SYNC_ENRICHMENT_ALARM, {
      delayInMinutes: 2,
    });
  });
});
