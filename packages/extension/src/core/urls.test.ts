import { describe, expect, it } from 'vitest';
import { isWebPageUrl } from './urls';

describe('isWebPageUrl', () => {
  it.each([
    ['https://example.com/article', true],
    ['http://example.com', true],
    ['file:///Users/someone/notes.html', false],
    ['view-source:https://example.com', false],
    ['chrome-extension://abcdef/options.html', false],
    ['chrome://settings', false],
    ['about:blank', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s is a web page: %s', (url, expected) => {
    expect(isWebPageUrl(url)).toBe(expected);
  });
});
