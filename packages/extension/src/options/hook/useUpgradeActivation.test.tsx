// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { useAppStore } from '../store';
import { ToastProvider } from './ToastProvider';
import {
  UPGRADE_POLL_ATTEMPTS,
  UPGRADE_POLL_INTERVAL_MS,
  useUpgradeActivation,
} from './useUpgradeActivation';

describe('useUpgradeActivation', () => {
  const originalState = useAppStore.getState();
  const refreshEntitlements = vi.fn(async () => undefined);
  let container: HTMLDivElement;
  let root: TestRoot;
  let expectUpgrade: () => void = () => undefined;

  function Probe() {
    expectUpgrade = useUpgradeActivation().expectUpgrade;
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    refreshEntitlements.mockClear();
    useAppStore.setState({ ...originalState, isSignedIn: true, isPro: false, refreshEntitlements });
    ({ container, root } = createTestRoot());
    await act(async () =>
      root.render(
        <ToastProvider>
          <Probe />
        </ToastProvider>
      )
    );
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const returnToPage = () => act(async () => window.dispatchEvent(new Event('focus')));

  it('does nothing on focus when no checkout was started', async () => {
    await returnToPage();
    expect(refreshEntitlements).not.toHaveBeenCalled();
  });

  it('polls the plan after returning from checkout and announces Pro once', async () => {
    expectUpgrade();
    await returnToPage();
    expect(refreshEntitlements).toHaveBeenCalledWith(true);
    await act(async () => vi.advanceTimersByTime(UPGRADE_POLL_INTERVAL_MS * 2));
    expect(refreshEntitlements).toHaveBeenCalledTimes(3);

    await act(async () => useAppStore.setState({ isPro: true }));
    expect(document.body.textContent).toContain('pro_activated_title');
    await act(async () => vi.advanceTimersByTime(UPGRADE_POLL_INTERVAL_MS * 5));
    expect(refreshEntitlements).toHaveBeenCalledTimes(3);
  });

  it('stops after a bounded number of attempts and resumes on the next return', async () => {
    expectUpgrade();
    await returnToPage();
    await act(async () =>
      vi.advanceTimersByTime(UPGRADE_POLL_INTERVAL_MS * UPGRADE_POLL_ATTEMPTS * 2)
    );
    expect(refreshEntitlements).toHaveBeenCalledTimes(UPGRADE_POLL_ATTEMPTS);

    await returnToPage();
    expect(refreshEntitlements).toHaveBeenCalledTimes(UPGRADE_POLL_ATTEMPTS + 1);
  });
});
