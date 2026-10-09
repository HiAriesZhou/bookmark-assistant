import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCurrentPageAi, requestCurrentPageSave } from './save-current-page';

describe('requestCurrentPageSave', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses a bounded channel for the base save acknowledgement', async () => {
    vi.useFakeTimers();
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(() => response) },
    });

    const pending = requestCurrentPageSave();
    await vi.advanceTimersByTimeAsync(119_000);
    resolveResponse({ success: true, aiStatus: 'succeeded' });

    await expect(pending).resolves.toEqual({ success: true, aiStatus: 'succeeded' });
  });

  it('keeps the separate AI channel alive for its bounded processing flow', async () => {
    vi.useFakeTimers();
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const sendMessage = vi.fn(() => response);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const pending = requestCurrentPageAi('ai-request-1');
    await vi.advanceTimersByTimeAsync(210_000);
    resolveResponse({ success: true, aiStatus: 'succeeded' });

    await expect(pending).resolves.toEqual({ success: true, aiStatus: 'succeeded' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'GENERATE_CURRENT_PAGE_AI',
      aiRequestId: 'ai-request-1',
    });
  });
});
