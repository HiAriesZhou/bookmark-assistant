// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readPageDescription } from './content';

afterEach(() => {
  document.head.innerHTML = '';
});

it('prefers the meta description and falls back to Open Graph and Twitter', () => {
  document.head.innerHTML = `
    <meta name="twitter:description" content="Twitter text">
    <meta property="og:description" content="Open Graph text">`;
  expect(readPageDescription(document)).toEqual({
    url: document.location.href,
    description: 'Open Graph text',
  });

  document.head.innerHTML += '<meta name="description" content="  Page summary  ">';
  expect(readPageDescription(document).description).toBe('Page summary');
});

it('returns no description for a page without one and caps long text', () => {
  expect(readPageDescription(document).description).toBeUndefined();

  document.head.innerHTML = `<meta name="description" content="${'a'.repeat(3000)}">`;
  expect(readPageDescription(document).description).toHaveLength(1000);
});
