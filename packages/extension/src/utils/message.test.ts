import { afterEach, describe, expect, it, vi } from 'vitest';
import { Messages, addMessageListener, sendMessage } from './message';

describe('sendMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allows a caller to disable the timeout for a long-running operation', async () => {
    vi.useFakeTimers();
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(() => response) },
    });

    const pending = sendMessage({ type: Messages.SYNC_ALL_BOOKMARKS }, { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(600_000);
    resolveResponse({ success: true });

    await expect(pending).resolves.toEqual({ success: true });
  });
});

describe('addMessageListener', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers only the extension’s own pages', async () => {
    let listener: (msg: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext',
        getURL: (path: string) => `chrome-extension://ext/${path}`,
        onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      },
    });
    const handler = vi.fn(async () => ({ success: true }));
    addMessageListener({ [Messages.DISCONNECT_NOTION]: handler });

    const send = (sender: unknown) =>
      new Promise((resolve) => listener({ type: Messages.DISCONNECT_NOTION }, sender, resolve));

    await expect(send({ id: 'ext', url: 'chrome-extension://ext/options.html' })).resolves.toEqual({
      success: true,
    });
    await expect(
      send({ id: 'ext', url: 'https://example.com/page', tab: { id: 1 } })
    ).resolves.toMatchObject({ success: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
