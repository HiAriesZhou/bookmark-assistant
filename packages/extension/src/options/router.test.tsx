// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { normalizeHash, useHashRoute } from './router';

it('guards history changes with the latest draft state and restores the URL on rejection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '#/library');
  const container = document.createElement('div');
  const root = createRoot(container);
  const cleanGuard = vi.fn(() => true);
  const dirtyGuard = vi.fn(() => false);
  function Harness({ guard }: { guard: () => boolean }) {
    const { route, navigate } = useHashRoute(guard);
    return <button onClick={() => navigate('settings')}>{route}</button>;
  }
  const historyChange = async (hash: string) => {
    await act(async () => {
      window.history.replaceState(null, '', hash);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  };
  try {
    await act(async () => root.render(<Harness guard={cleanGuard} />));
    await act(async () => root.render(<Harness guard={dirtyGuard} />));
    await historyChange('#/destinations');
    expect(container.textContent).toBe('library');
    expect(window.location.hash).toBe('#/library');
    expect(dirtyGuard).toHaveBeenCalledTimes(1);
    expect(cleanGuard).not.toHaveBeenCalled();

    dirtyGuard.mockReturnValue(true);
    await historyChange('#/destinations');
    expect(container.textContent).toBe('destinations');
    await act(async () => container.querySelector('button')?.click());
    expect(container.textContent).toBe('settings');
    expect(window.location.hash).toBe('#/settings');
    expect(dirtyGuard).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('maps the retired organize route back to the library', () => {
  window.history.replaceState(null, '', '#/organize');
  expect(normalizeHash(window.location.hash)).toBe('library');
});
