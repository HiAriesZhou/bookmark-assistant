import { useCallback, useEffect, useState } from 'react';
import type { LibraryFilter } from '../library/bookmark-library';
import { useLocalLibrary } from './hook/useLocalLibrary';
import { useHashRoute } from './router';
import { Sidebar } from './components/Sidebar';
import { LocalLibraryWorkspace } from './components/LocalLibraryWorkspace';
import { DestinationsWorkspace } from './components/DestinationsWorkspace';
import { SettingsWorkspace } from './components/SettingsWorkspace';
import { createTranslator } from '../utils/i18n';

export default function Options() {
  const localLibrary = useLocalLibrary();
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const { t } = createTranslator();
  const confirmDiscardDraft = useCallback(() => {
    if (hasUnsavedDraft && !window.confirm(t('library_discard_changes_confirm'))) return false;
    setHasUnsavedDraft(false);
    if (hasUnsavedDraft) setEditorRevision((revision) => revision + 1);
    return true;
  }, [hasUnsavedDraft, t]);
  const { route, navigate } = useHashRoute(confirmDiscardDraft);
  const [visitedRoutes, setVisitedRoutes] = useState(() => new Set([route]));

  useEffect(() => {
    setVisitedRoutes((current) => {
      if (current.has(route)) return current;
      const next = new Set(current);
      next.add(route);
      return next;
    });
  }, [route]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [hasUnsavedDraft]);

  const openLibrary = (filter: LibraryFilter) => {
    if (route === 'library' && !confirmDiscardDraft()) return;
    setLibraryFilter(filter);
    if (route !== 'library') navigate('library');
  };

  return (
    <div className="h-dvh overflow-hidden bg-library-canvas text-library-ink md:p-3">
      <div className="mx-auto flex h-full w-full max-w-[1540px] flex-col overflow-hidden border-library-line bg-library-paper shadow-library md:flex-row md:rounded-[22px] md:border">
        <Sidebar
          active={route}
          library={localLibrary.library}
          filter={libraryFilter}
          onNavigate={navigate}
          onFilterChange={openLibrary}
        />
        <main
          className={`min-h-0 min-w-0 flex-1 ${route === 'library' ? 'overflow-hidden' : 'overflow-y-auto p-4 sm:p-6 lg:p-8'}`}
        >
          <div hidden={route !== 'library'} className="h-full">
            <LocalLibraryWorkspace
              controller={localLibrary}
              filter={libraryFilter}
              onFilterChange={setLibraryFilter}
              hasUnsavedDraft={hasUnsavedDraft}
              onUnsavedDraftChange={setHasUnsavedDraft}
              editorRevision={editorRevision}
            />
          </div>
          {route === 'destinations' || visitedRoutes.has('destinations') ? (
            <div hidden={route !== 'destinations'}>
              <DestinationsWorkspace />
            </div>
          ) : null}
          {route === 'settings' || visitedRoutes.has('settings') ? (
            <div hidden={route !== 'settings'}>
              <SettingsWorkspace active={route === 'settings'} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
