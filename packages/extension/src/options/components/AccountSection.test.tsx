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

  const googleButton = () =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('account_sign_in_google')
    );
  const orDivider = () => container.querySelector('[role="separator"]');
  const emailInput = () => container.querySelector<HTMLInputElement>('input[type="email"]');

  async function changeInput(input: HTMLInputElement | null, value: string) {
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('offers Google first, then an or divider, then email when both methods are enabled', async () => {
    await render();
    expect(container.textContent).toContain('account_sign_in_intro');
    const google = googleButton();
    expect(google?.querySelector('svg')).not.toBeNull();
    expect(orDivider()?.textContent).toBe('account_or_divider');
    const email = emailInput();
    expect(email).not.toBeNull();
    expect(google!.compareDocumentPosition(orDivider()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(orDivider()!.compareDocumentPosition(email!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows only the email form without a divider when Google is disabled', async () => {
    sendMessage.mockResolvedValue(profile(['email', 'notion']));
    await render();
    expect(container.textContent).toContain('account_sign_in_intro');
    expect(emailInput()).not.toBeNull();
    expect(googleButton()).toBeUndefined();
    expect(orDivider()).toBeNull();
  });

  it('shows only the Google button without a divider when email is disabled', async () => {
    sendMessage.mockResolvedValue(profile(['google', 'notion']));
    await render();
    expect(container.textContent).toContain('account_sign_in_intro');
    expect(googleButton()).toBeDefined();
    expect(emailInput()).toBeNull();
    expect(orDivider()).toBeNull();
  });

  it('points Notion-only servers to the destination page', async () => {
    sendMessage.mockResolvedValue(profile(['notion']));
    await render();
    expect(emailInput()).toBeNull();
    expect(googleButton()).toBeUndefined();
    expect(orDivider()).toBeNull();
    expect(container.textContent).toContain('account_signed_out_notion_only');
    expect(container.textContent).not.toContain('account_sign_in_intro');
  });

  it('asks for the emailed code after sending it', async () => {
    await render();
    await changeInput(emailInput(), ' person@example.com ');
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'account_send_code'
    );
    await act(async () => {
      send?.click();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SIGN_IN_EMAIL_START', email: 'person@example.com' })
    );
    expect(container.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'account_sign_in'
      )
    ).toBe(true);
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
    expect(emailInput()).toBeNull();
    expect(orDivider()).toBeNull();
  });
});
