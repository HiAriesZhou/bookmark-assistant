// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('presents an accessible confirmation and can be dismissed with Escape', async () => {
  const onCancel = vi.fn();
  await act(async () => {
    root.render(
      <ConfirmDialog
        open
        title="Delete this bookmark?"
        description="The bookmark will be removed from Chrome."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />
    );
  });

  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain('Delete this bookmark?');
  expect(document.activeElement?.textContent).toBe('Cancel');

  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onCancel).toHaveBeenCalledOnce();
});
