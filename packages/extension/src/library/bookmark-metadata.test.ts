import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKMARK_METADATA_STORAGE_KEY,
  normalizeBookmarkTags,
  readBookmarkMetadata,
  saveBookmarkMetadata,
} from './bookmark-metadata';

describe('local bookmark metadata', () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(storage, value)),
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps metadata independent for duplicate URLs represented by different bookmark IDs', async () => {
    await saveBookmarkMetadata('bookmark-1', { description: 'First copy', tags: ['Research'] });
    await saveBookmarkMetadata('bookmark-2', { description: 'Second copy', tags: ['Later'] });

    const metadata = await readBookmarkMetadata();
    expect(metadata['bookmark-1']).toMatchObject({ description: 'First copy', tags: ['Research'] });
    expect(metadata['bookmark-2']).toMatchObject({ description: 'Second copy', tags: ['Later'] });
  });

  it('normalizes whitespace and case-insensitive duplicate tags', () => {
    expect(normalizeBookmarkTags(['  Product  Design ', 'product design', '', 'AI'])).toEqual([
      'Product Design',
      'AI',
    ]);
  });

  it('ignores malformed entries without discarding valid metadata', async () => {
    storage[BOOKMARK_METADATA_STORAGE_KEY] = {
      schemaVersion: 1,
      byBookmarkId: {
        good: { description: 'Useful', tags: ['Keep'], updatedAt: '2026-09-07T00:00:00.000Z' },
        bad: { tags: 'not-an-array', updatedAt: 'yesterday' },
      },
    };

    await expect(readBookmarkMetadata()).resolves.toEqual({
      good: { description: 'Useful', tags: ['Keep'], updatedAt: '2026-09-07T00:00:00.000Z' },
    });
  });

  it('uses an origin-wide lock so separate extension pages cannot overwrite each other', async () => {
    let lockQueue: Promise<unknown> = Promise.resolve();
    const request = vi.fn(<T>(_name: string, operation: () => Promise<T>): Promise<T> => {
      const next = lockQueue.then(operation, operation);
      lockQueue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    });
    vi.stubGlobal('navigator', { locks: { request } });

    vi.resetModules();
    const firstPage = await import('./bookmark-metadata');
    vi.resetModules();
    const secondPage = await import('./bookmark-metadata');

    await Promise.all([
      firstPage.saveBookmarkMetadata('bookmark-1', { tags: ['First'] }),
      secondPage.saveBookmarkMetadata('bookmark-2', { tags: ['Second'] }),
    ]);

    await expect(firstPage.readBookmarkMetadata()).resolves.toMatchObject({
      'bookmark-1': { tags: ['First'] },
      'bookmark-2': { tags: ['Second'] },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
