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
vi.mock('./BillingSection', () => ({ BillingSection: () => <section>Billing section</section> }));
vi.mock('./AiSettingsSection', () => ({ AiSettingsSection: () => <section>AI section</section> }));
vi.mock('./SyncSettingsSection', () => ({
  SyncSettingsSection: () => <section>Sync section</section>,
}));
vi.mock('./ServiceDataSection', () => ({
  ServiceDataSection: () => <section>Service data section</section>,
}));
vi.mock('./DestinationsSummarySection', () => ({
  DestinationsSummarySection: ({ onOpenDestinations }: { onOpenDestinations: () => void }) => (
    <button type="button" onClick={onOpenDestinations}>
      Destinations summary
    </button>
  ),
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
    for (const hidden of [
      'Account section',
      'Billing section',
      'AI section',
      'Sync section',
      'Destinations summary',
      'Service data section',
      'settings_sections_label',
    ]) {
      expect(container.textContent).not.toContain(hidden);
    }
    expect(container.querySelector('nav')).toBeNull();
    expect(refreshEntitlements).not.toHaveBeenCalled();
  });

  it('orders signed-in sections from account to the danger zone', async () => {
    useAppStore.setState({ isSignedIn: true, userId: 'user-a' });
    await render();
    const text = container.textContent ?? '';
    const order = [
      'Account section',
      'Billing section',
      'AI section',
      'Sync section',
      'Destinations summary',
      'Service data section',
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('Login page');
    expect(
      Array.from(container.querySelectorAll('nav button')).map((button) => button.textContent)
    ).toEqual(['account_title', 'AI', 'nav_sync_settings', 'nav_destinations']);

    const summary = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Destinations summary'
    );
    await act(async () => summary?.click());
    expect(onNavigate).toHaveBeenCalledWith('destinations');
  });

  it('switches in place after sign-in and requests entitlements for every new account', async () => {
    await render();
    expect(container.textContent).toContain('Login page');

    await setAccount({ isSignedIn: true, userId: 'user-a' });
    expect(container.textContent).toContain('AI section');
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
