// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { useAppStore } from '../store';
import { SettingsWorkspace } from './SettingsWorkspace';

vi.mock('./AccountSection', () => ({
  AccountSection: () => <section>Account section</section>,
  AccountSignIn: () => <section>Login page</section>,
}));
vi.mock('./AiSettingsSection', () => ({ AiSettingsSection: () => <section>AI section</section> }));
vi.mock('./SyncSettingsSection', () => ({
  SyncSettingsSection: () => <section>Sync section</section>,
}));
vi.mock('./AccountActions', () => ({
  AccountActions: () => <section>Account actions</section>,
}));

describe('SettingsWorkspace', () => {
  const originalState = useAppStore.getState();
  const refreshEntitlements = vi.fn(async () => undefined);
  const refreshDashboard = vi.fn(async () => undefined);
  const onNavigate = vi.fn();
  let container: HTMLDivElement;
  let root: TestRoot;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    refreshEntitlements.mockClear();
    refreshDashboard.mockClear();
    onNavigate.mockClear();
    useAppStore.setState({
      ...originalState,
      deploymentMode: 'hosted',
      commerceEnabled: true,
      isSignedIn: false,
      userId: '',
      refreshEntitlements,
      refreshDashboard,
    });
    ({ container, root } = createTestRoot());
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  const render = () => act(async () => root.render(<SettingsWorkspace onNavigate={onNavigate} />));
  const setAccount = (state: { isSignedIn: boolean; userId: string }) =>
    act(async () => useAppStore.setState(state));

  it('renders only the login page while signed out', async () => {
    await render();
    expect(container.textContent).toContain('Login page');
    for (const hidden of ['Account section', 'AI section', 'Sync section', 'Account actions']) {
      expect(container.textContent).not.toContain(hidden);
    }
    expect(container.querySelector('nav')).toBeNull();
    expect(refreshEntitlements).not.toHaveBeenCalled();
  });

  it('orders Pro sections from account to the account actions without a title or section nav', async () => {
    useAppStore.setState({
      isSignedIn: true,
      userId: 'user-a',
      isPro: true,
      capabilities: { autoSync: true, batchAi: true },
    });
    await render();
    const text = container.textContent ?? '';
    const order = ['Account section', 'AI section', 'Sync section', 'Account actions'].map(
      (label) => text.indexOf(label)
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('Login page');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
  });

  it.each([
    ['hosted Free', { capabilities: { autoSync: false, batchAi: false } }],
    // The plan is unknown right after sign-in, so Pro entries wait instead of flashing.
    ['loading', { capabilities: undefined, isRefreshingProfile: true }],
  ])('shows only the account group and account actions for %s', async (_, plan) => {
    useAppStore.setState({ isSignedIn: true, userId: 'user-a', isPro: false, ...plan });
    await render();
    const text = container.textContent ?? '';
    for (const shown of ['Account section', 'Account actions']) expect(text).toContain(shown);
    expect(text).not.toContain('AI section');
    expect(text).not.toContain('Sync section');
  });

  it('asks for a GitHub star in the footer only after sign-in', async () => {
    await render();
    expect(container.textContent).not.toContain('footer_star_request');
    useAppStore.setState({ isSignedIn: true, userId: 'user-a' });
    await render();
    const footer = container.querySelector('footer');
    // The whole sentence is the link, led by the GitHub mark.
    const star = Array.from(footer?.querySelectorAll('a') ?? []).find(
      (link) => link.textContent === 'footer_star_request'
    );
    expect(star?.getAttribute('href')).toMatch(/^https:\/\//);
    expect(star?.getAttribute('rel')).toBe('noreferrer');
    expect(star?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    // Sections never contain the legal and support links.
    expect(container.querySelector('#settings')?.textContent).not.toContain('GPL-3.0-only');
  });

  it('shows every capability on self-hosted servers', async () => {
    useAppStore.setState({
      isSignedIn: true,
      userId: 'user-a',
      deploymentMode: 'self-hosted',
      capabilities: { autoSync: true, batchAi: true },
    });
    await render();
    expect(container.textContent).toContain('AI section');
    expect(container.textContent).toContain('Sync section');
  });

  it('switches in place after sign-in and requests entitlements for every new account', async () => {
    await render();
    expect(container.textContent).toContain('Login page');

    await setAccount({ isSignedIn: true, userId: 'user-a' });
    expect(container.textContent).toContain('Account section');
    expect(refreshEntitlements).toHaveBeenCalledTimes(1);

    await render();
    expect(refreshEntitlements).toHaveBeenCalledTimes(1);

    await setAccount({ isSignedIn: false, userId: '' });
    expect(container.textContent).toContain('Login page');
    await setAccount({ isSignedIn: true, userId: 'user-b' });
    expect(refreshEntitlements).toHaveBeenCalledTimes(2);

    // Signing back in as the same account still refreshes, since sign-out cleared the plan.
    await setAccount({ isSignedIn: false, userId: '' });
    await setAccount({ isSignedIn: true, userId: 'user-b' });
    expect(refreshEntitlements).toHaveBeenCalledTimes(3);
    expect(refreshDashboard.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
