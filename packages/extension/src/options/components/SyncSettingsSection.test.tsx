// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import { SyncSettingsSection } from './SyncSettingsSection';

describe('SyncSettingsSection', () => {
  const originalState = useAppStore.getState();
  let container: HTMLDivElement;
  let root: TestRoot;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    ({ container, root } = createTestRoot());
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  async function render(state: { isPro: boolean; isConnected: boolean }) {
    const onOpenDestinations = vi.fn();
    useAppStore.setState({
      ...originalState,
      ...state,
      deploymentMode: 'hosted',
      capabilities: { autoSync: state.isPro, batchAi: state.isPro },
    });
    await act(async () =>
      root.render(
        <ToastProvider>
          <SyncSettingsSection onUpgrade={vi.fn()} onOpenDestinations={onOpenDestinations} />
        </ToastProvider>
      )
    );
    return onOpenDestinations;
  }

  const autoSyncSwitch = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="auto_sync_label"]');

  it('disables scheduled sync and links to Destinations when Pro has no destination', async () => {
    const onOpenDestinations = await render({ isPro: true, isConnected: false });
    expect(autoSyncSwitch()?.disabled).toBe(true);
    expect(container.querySelector('[role="note"]')?.textContent).toContain(
      'sync_needs_destination'
    );
    const go = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'destination_required_action'
    );
    await act(async () => go?.click());
    expect(onOpenDestinations).toHaveBeenCalledOnce();
  });

  it('shows no destination hint once a destination is connected', async () => {
    await render({ isPro: true, isConnected: true });
    expect(autoSyncSwitch()?.disabled).toBe(false);
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('keeps the Pro badge instead of the destination hint for Free', async () => {
    await render({ isPro: false, isConnected: false });
    expect(autoSyncSwitch()?.disabled).toBe(true);
    expect(container.querySelector('[role="note"]')).toBeNull();
    expect(container.textContent).toContain('pro');
  });
});
