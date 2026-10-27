import { beforeEach, expect, it, vi } from 'vitest';
import { Messages, OAUTH_MESSAGE_TIMEOUT_MS, sendMessage } from '../utils/message';
import { signInWithGoogleAccount } from './account-actions';
import { useAppStore } from './store';

vi.mock('../utils/message', async () => {
  const actual = await vi.importActual<typeof import('../utils/message')>('../utils/message');
  return { ...actual, sendMessage: vi.fn() };
});

vi.mock('../utils/account-state', async () => {
  const actual =
    await vi.importActual<typeof import('../utils/account-state')>('../utils/account-state');
  return { ...actual, readAccountContext: vi.fn(async () => ({ revision: 'rev-1' })) };
});

beforeEach(() => {
  vi.mocked(sendMessage).mockReset();
});

it('waits for the interactive Google consent instead of the default message timeout', async () => {
  vi.mocked(sendMessage).mockResolvedValue({ success: true, userEmail: 'person@example.com' });
  await signInWithGoogleAccount();
  expect(sendMessage).toHaveBeenCalledWith(
    { type: Messages.SIGN_IN_GOOGLE, accountRevision: 'rev-1' },
    { timeoutMs: OAUTH_MESSAGE_TIMEOUT_MS }
  );
  expect(useAppStore.getState().isSignedIn).toBe(true);
});
