import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLibrary } from './read-library';

vi.mock('../utils/reading-list', () => ({ getReadingListItems: vi.fn(async () => []) }));

describe('local library boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a library without account, storage credentials or network APIs', async () => {
    const tree = [{ id: '1', title: 'Example', url: 'https://example.com' }];
    vi.stubGlobal('chrome', {
      bookmarks: { getTree: vi.fn(async () => tree) },
      storage: { local: { get: vi.fn(async () => ({})) } },
    });
    const snapshot = await readLibrary();
    expect(snapshot.tree).toBe(tree);
    expect(snapshot.health.bookmarkCount).toBe(1);
    expect(snapshot.bookmarks).toHaveLength(1);
  });

  it('does not report an empty library when Chrome refuses the read', async () => {
    vi.stubGlobal('chrome', {
      bookmarks: { getTree: vi.fn().mockRejectedValue(new Error('Read failed')) },
      storage: { local: { get: vi.fn(async () => ({})) } },
    });
    await expect(readLibrary()).rejects.toThrow('Read failed');
  });
});
