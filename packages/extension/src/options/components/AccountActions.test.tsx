// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { AccountActions } from './AccountActions';

const signOutAccount = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../account-actions', async () => {
  const actual = await vi.importActual<typeof import('../account-actions')>('../account-actions');
  return { ...actual, signOutAccount };
});

describe('AccountActions', () => {
  const originalState = useAppStore.getState();
  let container: HTMLDivElement;
  let root: TestRoot;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    signOutAccount.mockClear();
    useAppStore.setState({ ...originalState, isSignedIn: true, userEmail: 'person@example.com' });
    ({ container, root } = createTestRoot());
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  const render = () =>
    act(async () =>
      root.render(
        <ToastProvider>
          <AccountActions />
        </ToastProvider>
      )
    );
  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label);

  it('keeps sign-out and deletion at the bottom with the deletion details only in the dialog', async () => {
    await render();
    expect(button('account_sign_out')).toBeDefined();
    expect(container.textContent).not.toContain('service_data_delete_desc');
    expect(document.body.textContent).not.toContain('service_data_delete_confirm_message');

    await act(async () => button('service_data_delete_action')?.click());
    expect(document.body.textContent).toContain('service_data_delete_confirm_message');
  });

  it('signs out from the bottom action', async () => {
    await render();
    await act(async () => button('account_sign_out')?.click());
    expect(signOutAccount).toHaveBeenCalledOnce();
  });

  it('renders nothing while signed out', async () => {
    useAppStore.setState({ isSignedIn: false });
    await render();
    expect(container.textContent).toBe('');
  });
});
