// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot } from '../../testing/react-root';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type AppState } from '../store';
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

describe('account entry', () => {
  const originalState = useAppStore.getState();

  async function renderEntry(state: Partial<AppState>) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
    });
    useAppStore.setState({ ...originalState, ...state });
    const { container, root } = createTestRoot();
    const onNavigate = vi.fn();
    await act(async () =>
      root.render(
        <Sidebar
          active="library"
          filter={{ kind: 'all' }}
          onNavigate={onNavigate}
          onFilterChange={vi.fn()}
        />
      )
    );
    const nav = container.querySelector('nav')!;
    const entry = nav.querySelectorAll('button')[1];
    return { container, root, nav, entry, onNavigate };
  }

  afterEach(() => {
    useAppStore.setState(originalState);
    vi.unstubAllGlobals();
  });

  it('replaces the settings gear with a login entry below Destinations when signed out', async () => {
    const { container, root, nav, entry, onNavigate } = await renderEntry({ isSignedIn: false });
    try {
      expect(nav.querySelectorAll('button')).toHaveLength(2);
      expect(nav.querySelectorAll('button')[0].textContent).toContain('nav_destinations');
      expect(nav.textContent).not.toContain('nav_settings');
      expect(entry.textContent).toContain('account_login');
      // The hint lives in the tooltip so the entry stays one row high.
      // The hint is screen-reader text and a tooltip, so the entry stays one row high.
      expect(entry.querySelector('.sr-only')?.textContent).toBe('account_local_no_account');
      expect(entry.getAttribute('title')).toBe('account_local_no_account');
      await act(async () => entry.click());
      expect(onNavigate).toHaveBeenCalledWith('settings');
    } finally {
      await cleanupTestRoot(root, container);
    }
  });

  it.each([
    ['Free', { deploymentMode: 'hosted' as const, isPro: false }, 'account_plan_free'],
    ['Pro', { deploymentMode: 'hosted' as const, isPro: true }, 'account_plan_pro'],
    [
      'self-hosted',
      { deploymentMode: 'self-hosted' as const, isPro: true },
      'account_plan_self_hosted',
    ],
  ])('shows the email and the %s plan badge when signed in', async (_, plan, badge) => {
    const { container, root, entry } = await renderEntry({
      ...plan,
      isSignedIn: true,
      userEmail: 'person@example.com',
    });
    try {
      expect(entry.textContent).toContain('person@example.com');
      expect(entry.textContent).toContain(badge);
      expect(entry.textContent).not.toContain('account_login');
      expect(entry.getAttribute('title')?.includes('localhost')).toBe(
        plan.deploymentMode === 'self-hosted'
      );
      // Avatar, name and plan pill share a single 36px row.
      expect(entry.className).toContain('h-9');
    } finally {
      await cleanupTestRoot(root, container);
    }
  });

  it('holds the plan badge place instead of showing Free while the plan loads', async () => {
    const { container, root, entry } = await renderEntry({
      deploymentMode: 'hosted',
      isSignedIn: true,
      isPro: false,
      isRefreshingProfile: true,
      capabilities: undefined,
      userEmail: 'person@example.com',
    });
    try {
      expect(entry.textContent).toContain('person@example.com');
      expect(entry.textContent).not.toContain('account_plan_free');
      expect(entry.textContent).not.toContain('account_plan_pro');
    } finally {
      await cleanupTestRoot(root, container);
    }
  });

  it('falls back to a Notion label for accounts created without an email', async () => {
    const { container, root, entry } = await renderEntry({
      deploymentMode: 'hosted',
      isSignedIn: true,
      userEmail: '',
    });
    try {
      expect(entry.textContent).toContain('account_notion_fallback');
      expect(entry.textContent).toContain('account_plan_free');
    } finally {
      await cleanupTestRoot(root, container);
    }
  });
});
