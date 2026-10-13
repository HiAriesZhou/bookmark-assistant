// @vitest-environment jsdom
import { act } from 'react';
import { createTestRoot, cleanupTestRoot } from '../testing/react-root';
import { expect, it, vi } from 'vitest';
import Options from './options';

vi.mock('./hook/useLocalLibrary', () => ({
  useLocalLibrary: () => ({ library: { bookmarks: [], folders: [], readingList: [] } }),
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ onNavigate }: { onNavigate: (route: string) => void }) => (
    <nav>
      <button type="button" onClick={() => onNavigate('library')}>
        Library
      </button>
      <button type="button" onClick={() => onNavigate('settings')}>
        Settings
      </button>
    </nav>
  ),
}));

vi.mock('./components/LocalLibraryWorkspace', () => ({
  LocalLibraryWorkspace: () => <div>Library workspace</div>,
}));

vi.mock('./components/DestinationsWorkspace', () => ({
  DestinationsWorkspace: () => <div>Destinations workspace</div>,
}));

vi.mock('./components/SettingsWorkspace', () => ({
  SettingsWorkspace: () => <input aria-label="Settings draft" />,
}));

it('keeps a visited settings page mounted while navigating between sections', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => 'en',
    },
  });
  window.history.replaceState(null, '', '#/library');
  const { container, root } = createTestRoot(false);
  const navigate = async (hash: string) => {
    await act(async () => {
      window.history.replaceState(null, '', hash);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  };

  try {
    await act(async () => root.render(<Options />));
    expect(container.querySelector('[aria-label="Settings draft"]')).toBeNull();

    await navigate('#/settings');
    const draft = container.querySelector('[aria-label="Settings draft"]') as HTMLInputElement;
    await act(async () => {
      draft.value = 'unsaved local value';
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await navigate('#/library');
    await navigate('#/settings');
    expect(
      (container.querySelector('[aria-label="Settings draft"]') as HTMLInputElement).value
    ).toBe('unsaved local value');
  } finally {
    await cleanupTestRoot(root, container);
    vi.unstubAllGlobals();
  }
});
