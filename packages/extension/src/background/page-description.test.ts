import { afterEach, expect, it, vi } from 'vitest';
import { readTabDescription } from './page-description';

afterEach(() => vi.unstubAllGlobals());

const stubScripting = (executeScript: (...args: any[]) => Promise<unknown>) =>
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn(executeScript) } });

it('reads the description of the page the user is saving', async () => {
  stubScripting(async () => [
    { result: { url: 'https://example.com/post', description: 'Post summary' } },
  ]);
  await expect(readTabDescription(7, 'https://example.com/post')).resolves.toBe('Post summary');
  expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({ target: { tabId: 7 } })
  );
});

it('drops a description read after the tab navigated elsewhere', async () => {
  stubScripting(async () => [
    { result: { url: 'https://example.com/other', description: 'Other page' } },
  ]);
  await expect(readTabDescription(7, 'https://example.com/post')).resolves.toBe('');
});

it('saves without a description when the page cannot be read', async () => {
  stubScripting(async () => {
    throw new Error('Cannot access contents of the page');
  });
  await expect(readTabDescription(7, 'https://example.com/post')).resolves.toBe('');
});
