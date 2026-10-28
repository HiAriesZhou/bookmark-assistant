import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCurrentPage } from './save-current-page';

afterEach(() => vi.unstubAllGlobals());

function stubSendMessage(result: unknown) {
  const sendMessage = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}

describe('saveCurrentPage', () => {
  it('reports a saved page', async () => {
    const sendMessage = stubSendMessage({ success: true });
    await expect(saveCurrentPage()).resolves.toEqual({ status: 'saved' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_CURRENT_PAGE' });
  });

  it('passes the background error through', async () => {
    stubSendMessage({ success: false, error: 'Not connected' });
    await expect(saveCurrentPage()).resolves.toEqual({ status: 'failed', error: 'Not connected' });
  });

  it('turns a messaging failure into a failed save', async () => {
    stubSendMessage(new Error('Could not establish connection'));
    await expect(saveCurrentPage()).resolves.toEqual({
      status: 'failed',
      error: 'Could not establish connection',
    });
  });
});
