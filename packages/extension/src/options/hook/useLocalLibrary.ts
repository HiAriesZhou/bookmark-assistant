import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteBookmark,
  saveBookmarkChanges,
  type BookmarkChanges,
} from '../../library/bookmark-actions';
import type { LocalBookmark } from '../../library/bookmark-library';
import { readLibrary } from '../../library/read-library';
import { BOOKMARK_METADATA_STORAGE_KEY } from '../../library/bookmark-metadata';

type Library = Awaited<ReturnType<typeof readLibrary>>;

/** One page-local snapshot; account changes cannot erase the local library. */
export function useLocalLibrary() {
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const mounted = useRef(true);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await readLibrary();
      if (mounted.current && request === revision.current) {
        setLibrary(next);
        setError(false);
      }
      return next;
    } catch {
      if (mounted.current && request === revision.current) setError(true);
      return undefined;
    }
  }, []);

  const save = useCallback(
    async (bookmark: LocalBookmark, changes: BookmarkChanges) => {
      setIsMutating(true);
      try {
        await saveBookmarkChanges(bookmark, changes);
        await refresh();
      } finally {
        if (mounted.current) setIsMutating(false);
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (bookmarkId: string) => {
      setIsMutating(true);
      try {
        await deleteBookmark(bookmarkId);
        await refresh();
      } finally {
        if (mounted.current) setIsMutating(false);
      }
    },
    [refresh]
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    mounted.current = true;
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    };
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === 'local' && BOOKMARK_METADATA_STORAGE_KEY in changes) scheduleRefresh();
    };
    const events = [
      chrome.bookmarks?.onCreated,
      chrome.bookmarks?.onChanged,
      chrome.bookmarks?.onMoved,
      chrome.bookmarks?.onRemoved,
      chrome.bookmarks?.onChildrenReordered,
      chrome.bookmarks?.onImportEnded,
    ];
    events.forEach((event) => event?.addListener(scheduleRefresh));
    chrome.storage?.onChanged?.addListener(onStorageChanged);
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      events.forEach((event) => event?.removeListener(scheduleRefresh));
      chrome.storage?.onChanged?.removeListener(onStorageChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { library, error, isMutating, refresh, save, remove };
}
