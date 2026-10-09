// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastView } from './Toast';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('uses the compact toast dimensions requested by popup surfaces', async () => {
  await act(async () => {
    root.render(
      <ToastView
        density="compact"
        item={{
          id: 'sync-result',
          title: 'Up to date',
          description: '',
          variant: 'info',
          duration: 4000,
        }}
        onClose={() => undefined}
      />
    );
  });

  const toast = container.querySelector('[data-toast-size="compact"]');
  expect(toast?.className).toContain('rounded-lg');
  expect(toast?.className).toContain('px-3');
  expect(toast?.className).toContain('py-2');
  expect(toast?.querySelector('svg')?.classList.contains('h-4')).toBe(true);
});
