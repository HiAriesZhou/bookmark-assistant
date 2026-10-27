// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { AccountSection, AccountSignIn } from './AccountSection';

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

describe('AccountSection and AccountSignIn', () => {
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

  async function render(Component: ComponentType = AccountSignIn) {
    await act(async () => {
      root.render(
        <ToastProvider>
          <Component />
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

  it('centers the signed-out login directly on the page without a card or label column', async () => {
    await render();
    const stack = googleButton()?.closest('.mx-auto');
    expect(stack?.contains(emailInput()!)).toBe(true);
    const intro = stack?.querySelector('p');
    expect(intro?.textContent).toBe('account_sign_in_intro');
    expect(intro?.classList.contains('text-center')).toBe(true);
    expect(container.querySelector('.bg-ui-surface')).toBeNull();
    const bordered = Array.from(container.querySelectorAll('[class~="border"]'));
    expect(bordered.every((element) => ['BUTTON', 'INPUT'].includes(element.tagName))).toBe(true);
    expect(
      Array.from(container.querySelectorAll('*')).some(
        (element) => element.textContent === 'account_sign_in'
      )
    ).toBe(false);
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

  const buttonNamed = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);

  it('points Notion-only servers to the destination page', async () => {
    sendMessage.mockResolvedValue(profile(['notion']));
    const onOpenDestinations = vi.fn();
    await render(() => <AccountSignIn onOpenDestinations={onOpenDestinations} />);
    expect(emailInput()).toBeNull();
    expect(googleButton()).toBeUndefined();
    expect(orDivider()).toBeNull();
    expect(container.textContent).toContain('account_signed_out_notion_only');
    expect(container.textContent).not.toContain('account_sign_in_intro');
    await act(async () => buttonNamed('destination_required_action')?.click());
    expect(onOpenDestinations).toHaveBeenCalledOnce();
  });

  it('shows a loading placeholder until the sign-in methods arrive', async () => {
    sendMessage.mockReturnValue(new Promise(() => undefined));
    await render();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).not.toContain('account_signed_out_notion_only');
    expect(emailInput()).toBeNull();
  });

  it('offers a retry instead of the Notion-only text when the server cannot be reached', async () => {
    sendMessage.mockResolvedValueOnce({ success: false, error: 'Invalid extension identity' });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'account_sign_in_methods_failed'
    );
    expect(container.textContent).not.toContain('account_signed_out_notion_only');

    await act(async () => buttonNamed('account_sign_in_methods_retry')?.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(googleButton()).toBeDefined();
    expect(emailInput()).not.toBeNull();
  });

  it('keeps cached sign-in methods when a refresh fails', async () => {
    useAppStore.setState({ signInMethods: ['email', 'notion'] });
    sendMessage.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(emailInput()).not.toBeNull();
  });

  it('tells signed-out users that local bookmarks need no account', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toContain('account_login_title');
    expect(container.textContent).toContain('account_continue_without_login');
    expect(container.textContent).toContain('account_login_ai_value');
    // The prior-Notion hint is a new-account notice shown only after sign-in.
    expect(container.textContent).not.toContain('account_prior_notion_hint');
    expect(container.textContent).not.toContain('account_sign_out');
  });

  it('omits the Pro value line on self-hosted servers', async () => {
    sendMessage.mockResolvedValue({
      success: true,
      profile: {
        deploymentMode: 'self-hosted',
        commerceEnabled: false,
        capabilities: { autoSync: true, batchAi: true },
        signInMethods: ['email', 'notion'],
      },
    });
    await render();
    expect(container.textContent).toContain('account_continue_without_login');
    expect(container.textContent).not.toContain('account_login_ai_value');
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

  it('groups the plan and account linking under the account title without sign-out', async () => {
    useAppStore.setState({
      isSignedIn: true,
      userEmail: 'person@example.com',
      showPriorNotionHint: true,
      signInMethods: ['email', 'google', 'notion'],
      hasGoogleSignIn: false,
      deploymentMode: 'hosted',
      commerceEnabled: false,
      isPro: false,
    });
    await render(AccountSection);
    expect(container.querySelector('#account-title')?.textContent).toBe('account_title');
    expect(container.textContent).toContain('account_plan_free');
    expect(container.textContent).toContain('account_link_google');
    expect(container.textContent).toContain('account_prior_notion_hint');
    // Identity lives in the sidebar; sign-out moves to the bottom of the page.
    expect(container.textContent).not.toContain('person@example.com');
    expect(container.textContent).not.toContain('account_sign_out');
    expect(emailInput()).toBeNull();
    expect(orDivider()).toBeNull();
  });
});
