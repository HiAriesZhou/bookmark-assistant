// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_MESSAGE_SOURCE } from '@bookmark-assistant/types';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { CHECKOUT_LOAD_TIMEOUT_MS, CheckoutDialog } from './CheckoutDialog';

const CHECKOUT_URL = 'https://www.example.com/checkout?_ptxn=txn_123';

describe('CheckoutDialog', () => {
  let container: HTMLDivElement;
  let root: TestRoot;
  const onClose = vi.fn();
  const onCompleted = vi.fn();
  const onFallback = vi.fn();
  const createWindow = vi.fn(async () => undefined);

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
      windows: { create: createWindow },
    });
    [onClose, onCompleted, onFallback, createWindow].forEach((mock) => mock.mockClear());
    ({ container, root } = createTestRoot());
    await act(async () =>
      root.render(
        <CheckoutDialog
          checkoutUrl={CHECKOUT_URL}
          onClose={onClose}
          onCompleted={onCompleted}
          onFallback={onFallback}
        />
      )
    );
  });

  afterEach(async () => {
    await cleanupTestRoot(root, container);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const frame = () => document.querySelector('iframe')!;
  const post = (status: string, source: Window | null = frame().contentWindow) =>
    act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: CHECKOUT_MESSAGE_SOURCE, status },
          origin: 'https://www.example.com',
          source,
        })
      )
    );

  it('embeds the checkout page in place and shows its own loading state', () => {
    const src = new URL(frame().src);
    expect(src.searchParams.get('_ptxn')).toBe('txn_123');
    expect(src.searchParams.get('embed')).toBe('1');
    expect(frame().getAttribute('allow')).toContain('payment');
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  });

  it('hides its loader once the checkout loads and ignores other windows', async () => {
    await post('completed', window);
    expect(onCompleted).not.toHaveBeenCalled();
    await post('loaded');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('reports completion and closing from the checkout', async () => {
    await post('completed');
    expect(onCompleted).toHaveBeenCalledOnce();
    await post('closed');
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to a checkout window when the embedded checkout cannot open', async () => {
    await post('unavailable');
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({ url: CHECKOUT_URL, type: 'popup' })
    );
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back when the checkout does not load in time', async () => {
    await act(async () => vi.advanceTimersByTime(CHECKOUT_LOAD_TIMEOUT_MS));
    expect(createWindow).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('can be cancelled while the checkout loads', async () => {
    const cancel = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'action_cancel'
    );
    await act(async () => cancel?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(createWindow).not.toHaveBeenCalled();
  });
});
