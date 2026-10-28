import { describe, expect, it, vi } from 'vitest';
import type { OrganizeBatch } from '../../core';
import { runOrganizeBatches, type BatchSender } from './useLibraryOrganize';

const batch = (id: string): OrganizeBatch => ({
  items: [{ id, parentId: '1', title: id, url: `https://${id}.example/`, folderPath: 'Bar' }],
  folders: [{ id: '10', path: 'Bar / Folder' }],
});

const proposal = (id: string) => ({
  bookmarkId: id,
  fromParentId: '1',
  toFolderId: '10',
  reason: '',
});

describe('runOrganizeBatches', () => {
  const options = () => ({
    isCancelled: () => false,
    onProgress: vi.fn(),
    sleep: vi.fn(async () => undefined),
  });

  it('keeps successful batches when a transient failure happens in between', async () => {
    const send: BatchSender = vi
      .fn()
      .mockResolvedValueOnce({ success: true, proposals: [proposal('a')] })
      .mockResolvedValueOnce({ success: false, errorCode: 'rate_limited' })
      .mockRejectedValueOnce(new Error('REQUEST_TIMEOUT'))
      .mockResolvedValueOnce({ success: true, proposals: [proposal('d')] });
    const progress = options();

    const result = await runOrganizeBatches(
      [batch('a'), batch('b'), batch('c'), batch('d')],
      send,
      progress
    );

    expect(result.proposals.map((item) => item.bookmarkId)).toEqual(['a', 'd']);
    expect(result.failedBatches.map((item) => item.items[0].id)).toEqual(['b', 'c']);
    expect(result.fatalError).toBeUndefined();
    expect(progress.onProgress).toHaveBeenLastCalledWith(4);
  });

  it('stops at a key problem and keeps the remaining batches for a retry', async () => {
    const send: BatchSender = vi
      .fn()
      .mockResolvedValueOnce({ success: true, proposals: [proposal('a')] })
      .mockResolvedValueOnce({ success: false, errorCode: 'invalid_api_key' });

    const result = await runOrganizeBatches([batch('a'), batch('b'), batch('c')], send, options());

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.fatalError).toBe('invalid_api_key');
    expect(result.proposals).toHaveLength(1);
    expect(result.failedBatches.map((item) => item.items[0].id)).toEqual(['b', 'c']);
  });

  it('stops before the next batch when cancelled and keeps the rest retryable', async () => {
    let cancelled = false;
    const send: BatchSender = vi.fn(async () => {
      cancelled = true;
      return { success: true, proposals: [proposal('a')] };
    });

    const result = await runOrganizeBatches([batch('a'), batch('b'), batch('c')], send, {
      isCancelled: () => cancelled,
      onProgress: vi.fn(),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.failedBatches.map((item) => item.items[0].id)).toEqual(['b', 'c']);
  });

  it('pauses for the provider retry delay after a rate limit, within a cap', async () => {
    const sleep = vi.fn(async () => undefined);
    const send: BatchSender = vi
      .fn()
      .mockResolvedValueOnce({ success: false, errorCode: 'rate_limited', retryAfterMs: 60_000 })
      .mockResolvedValueOnce({ success: false, errorCode: 'rate_limited' })
      .mockResolvedValueOnce({ success: false, errorCode: 'rate_limited' });

    await runOrganizeBatches([batch('a'), batch('b'), batch('c')], send, {
      ...options(),
      sleep,
    });

    expect(sleep.mock.calls).toEqual([[15_000], [5_000]]);
  });
});
