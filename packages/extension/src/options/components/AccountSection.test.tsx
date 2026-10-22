// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { AccountSection } from './AccountSection';

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('../../utils/message', () => ({
  sendMessage,
  Messages: {
    SIGN_IN_EMAIL_START: 'SIGN_IN_EMAIL_START',
    SIGN_IN_EMAIL_VERIFY: 'SIGN_IN_EMAIL_VERIFY',
    SIGN_IN_GOOGLE: 'SIGN_IN_GOOGLE',
    SIGN_OUT: 'SIGN_OUT',
    GET_DEPLOYMENT_PROFILE: 'GET_DEPLOYMENT_PROFILE',
    DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  },
}));

const profile = (signInMethods: string[]) => ({
  success: true,
  profile: {
    deploymentMode: 'hosted',
    commerceEnabled: true,
    capabilities: { autoSync: false, batchAi: false },
    signInMethods,
  },
});

describe('AccountSection', () => {
  let container: HTMLDivElement;
  let root: TestRoot;
  const originalState = useAppStore.getState();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    ({ container, root } = createTestRoot());
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(profile(['email', 'google', 'notion']));
    useAppStore.setState({
      ...originalState,
      isSignedIn: false,
      userEmail: '',
      signInMethods: [],
      hasGoogleSignIn: false,
      showPriorNotionHint: false,
    });
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
  });

  async function render() {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AccountSection />
        </ToastProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('shows email and Google controls only for enabled sign-in methods', async () => {
    await render();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.textContent).toContain('account_sign_in_google');

    sendMessage.mockResolvedValue(profile(['notion']));
    useAppStore.setState({ signInMethods: ['notion'] });
    await render();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).not.toContain('account_sign_in_google');
  });

  it('shows the signed-in email, sign-out, and the prior Notion hint for a new account', async () => {
    useAppStore.setState({
      isSignedIn: true,
      userEmail: 'person@example.com',
      showPriorNotionHint: true,
      signInMethods: ['email', 'notion'],
    });
    await render();
    expect(container.textContent).toContain('person@example.com');
    expect(container.textContent).toContain('account_sign_out');
    expect(container.textContent).toContain('account_prior_notion_hint');
  });
});
