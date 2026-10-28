// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { useAppStore } from '../store';
import { SettingsWorkspace } from './SettingsWorkspace';

vi.mock('./SyncSettingsSection', () => ({
  SyncSettingsSection: ({ onOpenDestinations }: { onOpenDestinations: () => void }) => (
    <button type="button" onClick={onOpenDestinations}>
      Sync section
    </button>
  ),
}));

describe('SettingsWorkspace', () => {
  const originalState = useAppStore.getState();
  const refreshDashboard = vi.fn(async () => undefined);
  const onNavigate = vi.fn();
  let container: HTMLDivElement;
  let root: TestRoot;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    refreshDashboard.mockClear();
    onNavigate.mockClear();
    useAppStore.setState({ ...originalState, refreshDashboard });
    ({ container, root } = createTestRoot());
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  const render = () => act(async () => root.render(<SettingsWorkspace onNavigate={onNavigate} />));

  it('shows sync settings without a title, section nav, account or plan', async () => {
    await render();
    expect(container.textContent).toContain('Sync section');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
    for (const removed of ['account_title', 'subscription', 'account_sign_out', 'Pro']) {
      expect(container.querySelector('#settings')?.textContent).not.toContain(removed);
    }
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
  });

  it('opens the destinations page from the sync section', async () => {
    await render();
    const sync = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Sync section'
    );
    await act(async () => sync?.click());
    expect(onNavigate).toHaveBeenCalledWith('destinations');
  });

  it('keeps the source star link and legal links in the footer', async () => {
    await render();
    const footer = container.querySelector('footer');
    const star = Array.from(footer?.querySelectorAll('a') ?? []).find(
      (link) => link.textContent === 'footer_star_request'
    );
    expect(star?.getAttribute('href')).toMatch(/^https:\/\//);
    expect(star?.getAttribute('rel')).toBe('noreferrer');
    expect(star?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(footer?.textContent).toContain('GPL-3.0-only');
    expect(container.querySelector('#settings')?.textContent).not.toContain('GPL-3.0-only');
  });
});
