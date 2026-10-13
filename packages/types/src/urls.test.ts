import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from './index';

describe('normalizeLinkUrl', () => {
  it.each([
    ['https://example.com/page/', 'https://example.com/page'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/page#section', 'https://example.com/page'],
    ['https://example.com/page?b=2&a=1', 'https://example.com/page?a=1&b=2'],
    ['https://example.com/page?a=1&b=2', 'https://example.com/page?a=1&b=2'],
    ['https://example.com/page', 'https://example.com/page'],
    ['https://example.com/path/?b=2&a=1#fragment', 'https://example.com/path?a=1&b=2'],
    ['https://example.com:8080/page/', 'https://example.com:8080/page'],
    ['http://example.com/page/', 'http://example.com/page'],
    ['https://example.com/page%20name/', 'https://example.com/page%20name'],
    ['https://example.com/page?', 'https://example.com/page'],
    ['https://example.com/page?b=2&a=1&a=3', 'https://example.com/page?a=1&a=3&b=2'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLinkUrl(input)).toBe(expected);
    expect(normalizeLinkUrl(expected)).toBe(expected);
  });

  it('leaves invalid-input policy to the caller', () => {
    expect(() => normalizeLinkUrl('not-a-valid-url')).toThrow(TypeError);
  });
});
