// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot } from '../../testing/react-root';
import { expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

it('collapses descendants without navigating and preserves nested collapse state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string, args?: string[]) => `${key} ${args?.[0] ?? ''}`.trim(),
      getUILanguage: () => 'en',
    },
  });
  const { container, root } = createTestRoot();
  const navigate = vi.fn();
  const click = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  try {
    await act(async () =>
      root.render(
        <Sidebar
          active="library"
          filter={{ kind: 'all' }}
          onNavigate={vi.fn()}
          onFilterChange={navigate}
          library={{
            bookmarks: [],
            tags: [],
            duplicateGroups: [],
            folders: [
              { id: '1', title: 'Root', path: 'Root', depth: 0 },
              { id: '2', title: 'Child', path: 'Root / Child', depth: 1 },
              { id: '3', title: 'Leaf', path: 'Root / Child / Leaf', depth: 2 },
              { id: '4', title: 'Sibling', path: 'Root / Sibling', depth: 1 },
              { id: '5', title: 'Other', path: 'Other', depth: 0 },
            ],
          }}
        />
      )
    );
    await click('library_collapse_folder Child');
    expect(container.textContent).not.toContain('Leaf');
    await click('library_collapse_folder Root');
    expect(container.textContent).not.toContain('Child');
    expect(container.textContent).not.toContain('Sibling');
    expect(container.textContent).toContain('Other');
    expect(navigate).not.toHaveBeenCalled();
    await click('library_expand_folder Root');
    expect(container.textContent).toContain('Child');
    expect(container.textContent).toContain('Sibling');
    expect(container.textContent).not.toContain('Leaf');
    await click('library_expand_folder Child');
    expect(container.textContent).toContain('Leaf');
  } finally {
    await cleanupTestRoot(root, container);
    vi.unstubAllGlobals();
  }
});
