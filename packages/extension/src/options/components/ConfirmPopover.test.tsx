// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmPopover } from './ConfirmPopover';

let container: HTMLDivElement;
let anchor: HTMLButtonElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  anchor = document.createElement('button');
  document.body.append(container, anchor);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    x: 280,
    y: 400,
    left: 280,
    right: 312,
    top: 400,
    bottom: 432,
    width: 32,
    height: 32,
    toJSON: () => ({}),
  });
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows a lightweight anchored confirmation without a page backdrop', async () => {
  const onCancel = vi.fn();
  await act(async () => {
    root.render(
      <ConfirmPopover
        open
        anchor={anchor}
        title="Delete?"
        description="This removes the matching Chrome bookmark."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />
    );
  });

  const popover = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(popover?.textContent).toContain('Delete?');
  expect(popover?.textContent).toContain('This removes the matching Chrome bookmark.');
  expect(popover?.style.bottom).not.toBe('');
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Cancel');

  await act(async () =>
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  );
  expect(onCancel).toHaveBeenCalledOnce();
});
