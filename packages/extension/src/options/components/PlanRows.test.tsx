// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { PlanRows } from './PlanRows';

const openPaddleCheckout = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../lib/paddle', () => ({ openPaddleCheckout }));

describe('PlanRows', () => {
  let container: HTMLDivElement;
  let root: TestRoot;
  const originalState = useAppStore.getState();
  const fetchPricing = vi.fn(async () => undefined);

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    ({ container, root } = createTestRoot());
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
      fetchPricing,
    });
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
  });

  it('defaults to yearly pricing and no longer offers lifetime checkout', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <PlanRows />
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
          <PlanRows />
        </ToastProvider>
      )
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows the Free plan for a service account without Pro', async () => {
    useAppStore.setState({ isSignedIn: true, userEmail: 'person@example.com' });
    await act(async () =>
      root.render(
        <ToastProvider>
          <PlanRows />
        </ToastProvider>
      )
    );
    // The plan name alone: no "current" marker, status dot or repeated email.
    expect(container.textContent).toContain('account_plan_free');
    expect(container.textContent).not.toContain('person@example.com');
    expect(container.textContent).not.toContain('subscription_free_current');
    expect(container.querySelector('.rounded-full.bg-ui-success')).toBeNull();
  });

  it('shows the Pro offer as a standing row in the product style and loads its price', async () => {
    useAppStore.setState({ isSignedIn: true, userEmail: 'person@example.com' });
    await act(async () =>
      root.render(
        <ToastProvider>
          <PlanRows />
        </ToastProvider>
      )
    );
    // The plan row states the account's plan; the comparison marks Free as current.
    expect(container.textContent).toContain('account_plan_label');
    const offer = container.querySelector<HTMLElement>('#plan-upgrade');
    const [free, pro] = Array.from(offer?.children ?? []) as HTMLElement[];
    expect(free?.textContent).toContain('account_plan_free');
    expect(free?.textContent).toContain('feature_manual_sync');
    expect(free?.textContent).toContain('plan_current');
    expect(free?.querySelector('button')).toBeNull();
    expect(pro?.textContent).toContain('account_plan_pro');
    expect(pro?.textContent).toContain('feature_everything_in_free');
    expect(pro?.textContent).toContain('action_upgrade_pro');
    // No toggle to open it, and none of the dark promotional card treatment.
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(container.innerHTML).not.toContain('#181b21');
    expect(fetchPricing).toHaveBeenCalled();
  });

  it('keeps the plan and comparison in place while a manual refresh runs', async () => {
    useAppStore.setState({
      isSignedIn: true,
      capabilities: { autoSync: false, batchAi: false },
      isRefreshingProfile: true,
    });
    await act(async () =>
      root.render(
        <ToastProvider>
          <PlanRows />
        </ToastProvider>
      )
    );
    expect(container.firstElementChild?.textContent).toContain('account_plan_free');
    expect(container.textContent).not.toContain('loading');
    expect(container.querySelector('#plan-upgrade')).not.toBeNull();
  });

  it('refreshes the plan when the user returns from checkout', async () => {
    const refreshEntitlements = vi.fn(async () => undefined);
    useAppStore.setState({
      isSignedIn: true,
      userId: 'user-a',
      capabilities: { autoSync: false, batchAi: false },
      refreshEntitlements,
    });
    await act(async () =>
      root.render(
        <ToastProvider>
          <PlanRows />
        </ToastProvider>
      )
    );
    const upgrade = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'action_upgrade_pro'
    );
    await act(async () => upgrade?.click());
    expect(openPaddleCheckout).toHaveBeenCalledOnce();
    expect(refreshEntitlements).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(refreshEntitlements).toHaveBeenCalledWith(true);
  });

  it('shows no Pro offer to Pro accounts', async () => {
    useAppStore.setState({
      isSignedIn: true,
      plan: 'pro',
      isPro: true,
      subscriptionSource: 'paddle',
    });
    await act(async () =>
      root.render(
        <ToastProvider>
          <PlanRows />
        </ToastProvider>
      )
    );
    expect(container.querySelector('#plan-upgrade')).toBeNull();
    expect(container.textContent).toContain('account_plan_pro');
  });
});
