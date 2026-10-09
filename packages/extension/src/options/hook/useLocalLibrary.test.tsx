// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readLibrary } from '../../library/read-library';
import { useLocalLibrary } from './useLocalLibrary';
import { BOOKMARK_METADATA_STORAGE_KEY } from '../../library/bookmark-metadata';

vi.mock('../../library/read-library', () => ({ readLibrary: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('refreshes on local metadata changes only and removes the listener on unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  type StorageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => void;
  const listeners = new Set<StorageListener>();
  vi.stubGlobal('chrome', {
    bookmarks: {},
    storage: {
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
      },
    },
  });
  const snapshot = { bookmarks: [{ metadata: { description: 'Original' } }] } as unknown as Awaited<
    ReturnType<typeof readLibrary>
  >;
  vi.mocked(readLibrary).mockReset().mockResolvedValue(snapshot);
  function Harness() {
    const { library } = useLocalLibrary();
    return <div>{library?.bookmarks[0].metadata.description}</div>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    const changed = (key: string, area = 'local') =>
      listeners.forEach((fn) => fn({ [key]: { newValue: {} } }, area));
    await act(async () => {
      changed('unrelated');
      changed(BOOKMARK_METADATA_STORAGE_KEY, 'sync');
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(readLibrary).toHaveBeenCalledTimes(1);
    vi.mocked(readLibrary).mockResolvedValue({
      ...snapshot,
      bookmarks: [
        {
          ...snapshot.bookmarks[0],
          metadata: {
            tags: ['Remote'],
            description: 'Updated elsewhere',
            updatedAt: '2026-09-08T00:00:00.000Z',
          },
        },
      ],
    });
    await act(async () => {
      changed(BOOKMARK_METADATA_STORAGE_KEY);
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(container.textContent).toBe('Updated elsewhere');
  } finally {
    await act(async () => root.unmount());
  }
  expect(listeners.size).toBe(0);
});

it('ignores stale reads and keeps the last local snapshot after a refresh fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const callbacks = new Set<() => void>();
  const event = {
    addListener: (fn: () => void) => callbacks.add(fn),
    removeListener: (fn: () => void) => callbacks.delete(fn),
  };
  vi.stubGlobal('chrome', { bookmarks: { onChanged: event } });
  const snapshot = {
    tree: [],
    readingList: [],
    health: { bookmarkCount: 2 },
  } as unknown as Awaited<ReturnType<typeof readLibrary>>;
  let completeFirst!: (value: typeof snapshot) => void;
  vi.mocked(readLibrary)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeFirst = resolve;
        })
    )
    .mockResolvedValueOnce(snapshot)
    .mockRejectedValueOnce(new Error('unavailable'));
  function Harness() {
    const { library, error } = useLocalLibrary();
    return (
      <div>
        {library?.health.bookmarkCount ?? 'loading'}:{String(error)}
      </div>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(container.textContent).toBe('2:false');
    await act(async () => {
      completeFirst({ ...snapshot, health: { ...snapshot.health, bookmarkCount: 1 } });
    });
    expect(container.textContent).toBe('2:false');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(container.textContent).toBe('2:true');
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
  expect(callbacks.size).toBe(0);
});
