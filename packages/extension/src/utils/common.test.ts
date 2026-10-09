import { describe, expect, it, vi } from 'vitest';
import { relativeTime } from './common';

describe('relativeTime', () => {
  it('formats dashboard times in the active UI locale', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-20T10:00:00.000Z'));
    const value = '2026-07-20T09:42:00.000Z';

    expect(relativeTime(value, 'en')).toBe('18 minutes ago');
    expect(relativeTime(value, 'zh-CN')).toBe('18分钟前');

    vi.restoreAllMocks();
  });

  it('uses a neutral placeholder for absent or invalid times', () => {
    expect(relativeTime(undefined, 'en')).toBe('—');
    expect(relativeTime('invalid', 'en')).toBe('—');
  });
});
