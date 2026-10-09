import { afterEach, describe, expect, it, vi } from 'vitest';
import { Messages, sendMessage } from './message';

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
