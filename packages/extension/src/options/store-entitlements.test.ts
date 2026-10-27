import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from './store';

vi.mock('../utils/message', async () => {
  const actual = await vi.importActual<typeof import('../utils/message')>('../utils/message');
  return { ...actual, sendMessage: vi.fn() };
});

const originalState = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(originalState);
  vi.unstubAllGlobals();
});

function stubStorage(get: () => Promise<Record<string, unknown>>) {
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(get) } } });
}

it.each([
  ['no session token', () => Promise.resolve({})],
  ['an unreadable account state', () => Promise.reject(new Error('storage unavailable'))],
])('clears the plan loading flag when a refresh finds %s', async (_, get) => {
  // A sign-in marks the plan as loading before refreshEntitlements runs.
  useAppStore.setState({ isSignedIn: true, isRefreshingProfile: true, capabilities: undefined });
  stubStorage(get);
  await useAppStore.getState().refreshEntitlements(true);
  expect(useAppStore.getState().isRefreshingProfile).toBe(false);
});
