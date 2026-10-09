import { describe, expect, it } from 'vitest';
import { getNotionRetryDelayMs, isRetryableNotionError } from './notion-retry';

describe('Notion retry policy', () => {
  it.each([429, 500, 502, 503, 504])('retries transient HTTP %i responses', (status) => {
    expect(isRetryableNotionError({ status })).toBe(true);
  });

  it('recognizes status text produced by the Notion client', () => {
    expect(
      isRetryableNotionError({ message: 'Request to Notion API failed with status: 502' })
    ).toBe(true);
  });

  it('does not retry a validation error', () => {
    expect(isRetryableNotionError({ status: 400, code: 'validation_error' })).toBe(false);
  });

  it('uses Notion Retry-After when rate limited', () => {
    expect(
      getNotionRetryDelayMs(
        { status: 429, headers: { get: (name: string) => (name === 'retry-after' ? '7' : null) } },
        0
      )
    ).toBe(7000);
  });
});
