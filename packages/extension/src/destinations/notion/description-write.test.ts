import { describe, expect, it, vi } from 'vitest';
import { fillMissingDescription, type DescriptionHistoryEntry } from './description-write';

function fixture(description = '') {
  const entries = new Map<string, DescriptionHistoryEntry>();
  const history = {
    get: async (id: string) => entries.get(id),
    reserve: async (id: string) => {
      if (entries.has(id)) return false;
      entries.set(id, { status: 'reserved' });
      return true;
    },
    protect: async (id: string) => {
      entries.set(id, { status: 'protected' });
    },
    release: async (id: string) => {
      if (entries.get(id)?.status === 'reserved') entries.delete(id);
    },
  };
  const api = {
    readDescription: vi.fn(async () => ({ property: 'Description', text: description })),
    writeDescription: vi.fn(async () => undefined),
  };
  const assertCurrent = vi.fn(async () => undefined);
  return { entries, history, api, assertCurrent };
}

describe('fillMissingDescription', () => {
  it('fills an untouched empty description once', async () => {
    const f = fixture();
    expect(await fillMissingDescription('page', 'inferred introduction', f)).toBe('written');
    expect(f.api.writeDescription).toHaveBeenCalledWith(
      'page',
      'Description',
      'inferred introduction'
    );
    expect(await fillMissingDescription('page', 'inferred introduction', f)).toBe('skipped');
    expect(f.api.writeDescription).toHaveBeenCalledTimes(1);
  });

  it('protects pre-existing user descriptions even if later cleared', async () => {
    const f = fixture('my notes');
    expect(await fillMissingDescription('page', 'ai', f)).toBe('skipped');
    f.api.readDescription.mockResolvedValue({ property: 'Description', text: '' });
    expect(await fillMissingDescription('page', 'ai', f)).toBe('skipped');
    expect(f.api.writeDescription).not.toHaveBeenCalled();
  });

  it('does not resend an uncertain write after an interruption', async () => {
    const f = fixture();
    f.api.writeDescription.mockRejectedValueOnce(new Error('connection lost'));
    await expect(fillMissingDescription('page', 'ai', f)).rejects.toThrow('connection lost');
    expect(await fillMissingDescription('page', 'ai', f)).toBe('skipped');
    expect(f.api.writeDescription).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when no write was sent', async () => {
    const f = fixture();
    f.api.readDescription
      .mockResolvedValueOnce({ property: 'Description', text: '' })
      .mockRejectedValueOnce(new Error('read failed'));
    await expect(fillMissingDescription('page', 'ai', f)).rejects.toThrow('read failed');
    expect(f.entries.has('page')).toBe(false);
    expect(f.api.writeDescription).not.toHaveBeenCalled();

    expect(await fillMissingDescription('page', 'ai', f)).toBe('written');
    expect(f.api.writeDescription).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when the description property disappears', async () => {
    const f = fixture();
    f.api.readDescription
      .mockResolvedValueOnce({ property: 'Description', text: '' })
      .mockResolvedValueOnce(undefined);
    expect(await fillMissingDescription('page', 'ai', f)).toBe('skipped');
    expect(f.entries.has('page')).toBe(false);
  });

  it('rereads before writing and preserves an intervening user edit', async () => {
    const f = fixture();
    f.api.readDescription
      .mockResolvedValueOnce({ property: 'Description', text: '' })
      .mockResolvedValueOnce({ property: 'Description', text: 'user edited' });
    expect(await fillMissingDescription('page', 'ai', f)).toBe('skipped');
    expect(f.api.writeDescription).not.toHaveBeenCalled();
  });

  it('rejects stale destination results before reserving or writing', async () => {
    const f = fixture();
    f.assertCurrent.mockRejectedValue(new Error('stale'));
    await expect(fillMissingDescription('page', 'ai', f)).rejects.toThrow('stale');
    expect(f.entries.size).toBe(0);
    expect(f.api.writeDescription).not.toHaveBeenCalled();
  });
});
