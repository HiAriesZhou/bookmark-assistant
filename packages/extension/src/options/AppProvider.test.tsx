// @vitest-environment jsdom
import { act } from 'react';
import { StrictMode } from 'react';
import { createTestRoot, cleanupTestRoot } from '../testing/react-root';
import { afterEach, expect, it, vi } from 'vitest';
import { sendMessage } from '../utils/message';
import { AppProvider, selectPlanPending, useAppStore } from './store';

vi.mock('../utils/message', async () => {
  const actual = await vi.importActual<typeof import('../utils/message')>('../utils/message');
  return { ...actual, sendMessage: vi.fn() };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('hydrates local state without requesting account, pricing, or destination data', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Set<() => void>();
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '1.3.2' }) },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
      },
    },
  });

  const { container, root } = createTestRoot(false);
  await act(async () => {
    root.render(
      <StrictMode>
        <AppProvider>
          <span>Library</span>
        </AppProvider>
      </StrictMode>
    );
  });

  expect(sendMessage).not.toHaveBeenCalled();
  await cleanupTestRoot(root, container);
  expect(listeners.size).toBe(0);
});

it('marks the plan as loading in the same update that signs the account in', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
  const listeners = new Set<Listener>();
  const stored: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '1.3.2' }) },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(stored))
              .filter((key) => key in stored)
              .map((key) => [key, stored[key]])
          )
        ),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
  });
  // The profile request never answers, so the plan stays unknown for the whole test.
  vi.mocked(sendMessage).mockReturnValue(new Promise(() => undefined));
  useAppStore.setState({ isSignedIn: false, isPro: false, capabilities: undefined });
  const signedInStates: boolean[] = [];
  const unsubscribe = useAppStore.subscribe((state) => {
    if (state.isSignedIn) signedInStates.push(selectPlanPending(state));
  });

  const { container, root } = createTestRoot(false);
  await act(async () => {
    root.render(
      <AppProvider>
        <span>Settings</span>
      </AppProvider>
    );
  });
  Object.assign(stored, {
    session_token: 'token',
    user_id: 'acct-1',
    account_state_revision: 'rev-1',
  });
  await act(async () => {
    for (const listener of listeners)
      listener(
        {
          session_token: { newValue: 'token' },
          user_id: { newValue: 'acct-1' },
          account_state_revision: { newValue: 'rev-1' },
        },
        'local'
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  unsubscribe();
  expect(signedInStates.length).toBeGreaterThan(0);
  expect(signedInStates.every(Boolean)).toBe(true);
  await cleanupTestRoot(root, container);
});
