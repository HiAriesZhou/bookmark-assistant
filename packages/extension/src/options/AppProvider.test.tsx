// @vitest-environment jsdom
import { act } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { sendMessage } from '../utils/message';
import { AppProvider } from './store';

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

  const container = document.createElement('div');
  const root = createRoot(container);
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
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
});
