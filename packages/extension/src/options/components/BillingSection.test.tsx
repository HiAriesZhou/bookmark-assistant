// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { BillingSection } from './BillingSection';

describe('BillingSection', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalState = useAppStore.getState();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({
      ...originalState,
      deploymentMode: 'hosted',
      commerceEnabled: true,
      isOptionsInitialized: true,
      plan: 'free',
      isPro: false,
      subscriptionSource: null,
      purchaseType: undefined,
      pricing: { monthly: 1.5, yearly: 11.9 },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useAppStore.setState(originalState);
  });

  it('defaults to yearly pricing and no longer offers lifetime checkout', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <BillingSection plansExpanded onTogglePlans={() => undefined} />
        </ToastProvider>
      );
    });

    const yearly = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'billing_yearly'
    );
    expect(yearly?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('$11.9');
    expect(container.textContent?.toLowerCase()).not.toContain('lifetime');

    const monthly = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'billing_monthly'
    );
    await act(async () => monthly?.click());
    expect(container.textContent).toContain('$1.5');
  });

  it('does not mount payment controls for self-hosted mode even with stale Paddle data', async () => {
    useAppStore.setState({
      deploymentMode: 'self-hosted',
      commerceEnabled: false,
      isPro: true,
      plan: 'pro',
      subscriptionSource: 'paddle',
      purchaseType: 'yearly',
    });
    await act(async () =>
      root.render(
        <ToastProvider>
          <BillingSection plansExpanded onTogglePlans={() => undefined} />
        </ToastProvider>
      )
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows local mode instead of Free before a service account exists', async () => {
    useAppStore.setState({ isSignedIn: false });
    await act(async () =>
      root.render(
        <ToastProvider>
          <BillingSection plansExpanded={false} onTogglePlans={() => undefined} />
        </ToastProvider>
      )
    );
    expect(container.textContent).toContain('subscription_local_mode');
    expect(container.textContent).not.toContain('subscription_free_current');
  });

  it('shows the Free plan for a service account without Pro', async () => {
    useAppStore.setState({ isSignedIn: true, userEmail: 'person@example.com' });
    await act(async () =>
      root.render(
        <ToastProvider>
          <BillingSection plansExpanded={false} onTogglePlans={() => undefined} />
        </ToastProvider>
      )
    );
    expect(container.textContent).toContain('subscription_free_current');
    expect(container.textContent).toContain('person@example.com');
  });
});
