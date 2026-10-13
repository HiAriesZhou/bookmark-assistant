// @vitest-environment jsdom
import { act, useState } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../../testing/react-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectMenu } from './SelectMenu';

let container: HTMLDivElement;
let root: TestRoot;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  ({ container, root } = createTestRoot());
});

afterEach(async () => {
  await cleanupTestRoot(root, container);
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

it('closes the menu and restores focus after Escape', async () => {
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
  await act(async () => trigger?.click());

  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
