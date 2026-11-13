import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKMARK_METADATA_STORAGE_KEY,
  fillBookmarkDescriptionIfUnchanged,
  hasDescriptionHistory,
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

  it('preserves a user-cleared description as a tombstone across reads', async () => {
    await saveBookmarkMetadata('cleared', { description: 'Before', tags: [] });
    await saveBookmarkMetadata('cleared', { description: '', tags: [] });
    expect((await readBookmarkMetadata()).cleared).toMatchObject({
      descriptionSource: 'user',
      descriptionCleared: true,
      tags: [],
    });
  });

  it('does not record a clear when an empty description is saved unchanged', async () => {
    // 编辑器每次保存都会提交描述字段；原本为空时只改标签不能变成“用户清空”。
    const saved = await saveBookmarkMetadata('tags-only', { description: '', tags: ['Research'] });
    expect(saved).not.toHaveProperty('descriptionCleared');
    expect(hasDescriptionHistory(saved)).toBe(false);
    const filled = await fillBookmarkDescriptionIfUnchanged(
      'tags-only',
      'Synthetic summary',
      'ai',
      saved,
      async () => true
    );
    expect(filled).toMatchObject({ description: 'Synthetic summary', tags: ['Research'] });
  });

  it('does not let a stale empty form clear a description written after it opened', async () => {
    const opened = await saveBookmarkMetadata('bookmark-1', { description: '', tags: [] });
    const filled = await fillBookmarkDescriptionIfUnchanged(
      'bookmark-1',
      'AI inference: A reference.',
      'ai',
      opened,
      async () => true
    );
    const saved = await saveBookmarkMetadata('bookmark-1', {
      description: '',
      tags: ['Research'],
      descriptionBaseline: { revision: opened.revision, description: '' },
    });

    expect(filled?.description).toBe('AI inference: A reference.');
    expect(saved).toMatchObject({
      description: 'AI inference: A reference.',
      descriptionSource: 'ai',
      tags: ['Research'],
    });
    expect(saved).not.toHaveProperty('descriptionCleared');
  });

  it('keeps an intentional description edit when background metadata changed', async () => {
    const opened = await saveBookmarkMetadata('bookmark-1', {
      description: 'Before',
      tags: [],
    });
    await saveBookmarkMetadata('bookmark-1', {
      description: 'AI inference: A reference.',
      descriptionSource: 'ai',
      tags: [],
    });

    const saved = await saveBookmarkMetadata('bookmark-1', {
      description: '',
      tags: [],
      descriptionBaseline: { revision: opened.revision, description: 'Before' },
    });

    expect(saved).toMatchObject({ descriptionCleared: true, descriptionSource: 'user' });
    expect(saved).not.toHaveProperty('description');
  });

  it('keeps an earlier clear when later saves leave the description empty', async () => {
    await saveBookmarkMetadata('cleared', { description: 'Before', tags: [] });
    await saveBookmarkMetadata('cleared', { description: '', tags: [] });
    const later = await saveBookmarkMetadata('cleared', { description: '', tags: ['Later'] });
    expect(later).toMatchObject({ descriptionCleared: true, descriptionSource: 'user' });
  });

  it('keeps automatic provenance while only tags change', async () => {
    await saveBookmarkMetadata('page', {
      description: 'Page metadata',
      descriptionSource: 'page',
      tags: [],
    });
    await saveBookmarkMetadata('page', { description: 'Page metadata', tags: ['Read'] });
    expect((await readBookmarkMetadata()).page).toMatchObject({
      descriptionSource: 'page',
      tags: ['Read'],
    });
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
