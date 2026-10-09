// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectMenu } from './SelectMenu';

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

it('shows the field prefix only in the trigger and selects a grouped option', async () => {
  function Harness() {
    const [value, setValue] = useState('all');
    return (
      <SelectMenu
        value={value}
        onChange={setValue}
        ariaLabel="Filter"
        prefix="Filter"
        options={[
          { value: 'all', label: 'All' },
          { value: 'design', label: 'Design', group: 'Tags' },
        ]}
      />
    );
  }

  await act(async () => root.render(<Harness />));
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Filter"]');
  expect(trigger?.textContent).toContain('Filter: All');

  await act(async () => trigger?.click());
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  expect(options.map((option) => option.textContent?.trim())).toEqual(['All', 'Design']);
  expect(document.body.textContent).toContain('Tags');

  await act(async () => options[1]?.click());
  expect(trigger?.textContent).toContain('Filter: Design');
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('opens upward near the viewport edge and restores focus after Escape', async () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });

  await act(async () =>
    root.render(
      <SelectMenu
        value="all"
        onChange={() => undefined}
        ariaLabel="Filter"
        options={[{ value: 'all', label: 'All' }]}
      />
    )
  );
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Filter"]');
  vi.spyOn(trigger!, 'getBoundingClientRect').mockReturnValue({
    x: 100,
    y: 660,
    top: 660,
    right: 220,
    bottom: 696,
    left: 100,
    width: 120,
    height: 36,
    toJSON: () => ({}),
  });

  await act(async () => trigger?.click());
  const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
  expect(listbox?.style.bottom).not.toBe('');
  expect(listbox?.style.top).toBe('');

  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
