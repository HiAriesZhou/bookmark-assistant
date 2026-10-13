// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmPopover } from './ConfirmPopover';

let container: HTMLDivElement;
let anchor: HTMLButtonElement;
let root: TestRoot;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({ container, root } = createTestRoot());
  anchor = document.createElement('button');
  document.body.appendChild(anchor);
});

afterEach(async () => {
  await cleanupTestRoot(root, container);
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('focuses cancel and dismisses confirmation on outside click', async () => {
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
  expect(document.activeElement?.textContent).toBe('Cancel');

  await act(async () =>
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  );
  expect(onCancel).toHaveBeenCalledOnce();
});
