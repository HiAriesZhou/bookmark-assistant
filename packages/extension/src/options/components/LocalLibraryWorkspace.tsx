import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  Pencil,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { BookmarkChanges } from '../../library/bookmark-actions';
import {
  filterLocalBookmarks,
  getBookmarkDomain,
  sortLocalBookmarks,
  type LibraryFilter,
  type LibrarySort,
  type LocalBookmark,
} from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import type { useLocalLibrary } from '../hook/useLocalLibrary';
import { BookmarkEditor } from './BookmarkEditor';
import { BookmarkFavicon } from './BookmarkFavicon';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmPopover } from './ConfirmPopover';
import { SelectMenu, type SelectMenuOption } from './SelectMenu';

type LocalLibraryController = ReturnType<typeof useLocalLibrary>;

const PAGE_SIZE = 200;

export function LocalLibraryWorkspace({
  controller,
  filter,
  onFilterChange,
  hasUnsavedDraft,
  onUnsavedDraftChange,
  editorRevision,
}: {
  controller: LocalLibraryController;
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  hasUnsavedDraft: boolean;
  onUnsavedDraftChange: (dirty: boolean) => void;
  editorRevision: number;
}) {
  const { t, locale } = createTranslator();
  const { library, error, isMutating, refresh, save, remove } = controller;
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedId, setSelectedId] = useState<string>();
  const [sort, setSort] = useState<LibrarySort>('date-desc');
  const [localEditorRevision, setLocalEditorRevision] = useState(0);
  const [focusTitleRevision, setFocusTitleRevision] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string }>();
  const [duplicateSnapshotIds, setDuplicateSnapshotIds] = useState<Set<string>>();
  const [pendingDelete, setPendingDelete] = useState<
    | { bookmark: LocalBookmark; presentation: 'dialog' }
    | { bookmark: LocalBookmark; presentation: 'popover'; anchor: HTMLButtonElement }
  >();

  useEffect(() => {
    if (filter.kind !== 'duplicates') {
      setDuplicateSnapshotIds(undefined);
      return;
    }
    if (!library) return;
    setDuplicateSnapshotIds((current) => current ?? collectDuplicateIds(library));
  }, [filter.kind, library]);

  const results = useMemo(() => {
    const bookmarks = library?.bookmarks ?? [];
    const usesDuplicateSnapshot = filter.kind === 'duplicates' && duplicateSnapshotIds;
    const source = usesDuplicateSnapshot
      ? bookmarks.filter((bookmark) => duplicateSnapshotIds.has(bookmark.id))
      : bookmarks;
    const effectiveFilter: LibraryFilter = usesDuplicateSnapshot ? { kind: 'all' } : filter;
    return sortLocalBookmarks(
      filterLocalBookmarks(source, effectiveFilter, deferredQuery),
      sort,
      locale
    );
  }, [deferredQuery, duplicateSnapshotIds, filter, library?.bookmarks, locale, sort]);
  const selected = library?.bookmarks.find((bookmark) => bookmark.id === selectedId);
  const heading = getViewHeading(filter, t, library);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [deferredQuery, filter, sort]);

  useEffect(() => {
    if (hasUnsavedDraft) return;
    if (!results.length) setSelectedId(undefined);
    else if (!selectedId || !results.some((bookmark) => bookmark.id === selectedId)) {
      setSelectedId(results[0].id);
    }
  }, [hasUnsavedDraft, results, selectedId]);

  const confirmDiscardDraft = () => {
    if (!hasUnsavedDraft) return true;
    if (!window.confirm(t('library_discard_changes_confirm'))) return false;
    onUnsavedDraftChange(false);
    setLocalEditorRevision((revision) => revision + 1);
    return true;
  };

  const selectBookmark = (bookmarkId: string) => {
    if (bookmarkId === selectedId || !confirmDiscardDraft()) return;
    setNotice(undefined);
    setSelectedId(bookmarkId);
  };

  const renameBookmark = (bookmarkId: string) => {
    if (bookmarkId !== selectedId && !confirmDiscardDraft()) return;
    setNotice(undefined);
    setSelectedId(bookmarkId);
    setFocusTitleRevision((revision) => revision + 1);
  };

  const changeFilter = (nextFilter: LibraryFilter) => {
    if (!confirmDiscardDraft()) return;
    setNotice(undefined);
    onFilterChange(nextFilter);
  };

  const handleSave = async (changes: BookmarkChanges) => {
    if (!selected) return;
    await save(selected, changes);
  };

  const refreshLibrary = async () => {
    setNotice(undefined);
    const next = await refresh();
    if (filter.kind === 'duplicates' && next) {
      setDuplicateSnapshotIds(collectDuplicateIds(next));
    }
  };

  const handleDelete = async (bookmark: LocalBookmark) => {
    const remainingCopies =
      library?.duplicateGroups
        .find((group) => group.bookmarks.some((candidate) => candidate.id === bookmark.id))
        ?.bookmarks.filter((candidate) => candidate.id !== bookmark.id) ?? [];

    await remove(bookmark.id);
    if (bookmark.id === selectedId) onUnsavedDraftChange(false);

    if (filter.kind === 'duplicates' && remainingCopies.length === 1) {
      if (bookmark.id === selectedId || !hasUnsavedDraft) setSelectedId(remainingCopies[0].id);
      setNotice({ kind: 'success', text: t('library_duplicate_removed_kept') });
      return;
    }

    if (bookmark.id === selectedId) setSelectedId(remainingCopies[0]?.id);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setNotice(undefined);
    try {
      await handleDelete(pendingDelete.bookmark);
    } catch {
      setNotice({ kind: 'error', text: t('library_delete_failed') });
    } finally {
      setPendingDelete(undefined);
    }
  };

  const filterOptions = createFilterOptions(filter, t, library);
  const sortOptions: SelectMenuOption[] = [
    {
      value: 'date-desc',
      label: t('library_sort_newest'),
      icon: <CalendarArrowDown className="h-3.5 w-3.5" />,
    },
    {
      value: 'date-asc',
      label: t('library_sort_oldest'),
      icon: <CalendarArrowUp className="h-3.5 w-3.5" />,
    },
    {
      value: 'title-asc',
      label: t('library_sort_az'),
      icon: <ArrowDownAZ className="h-3.5 w-3.5" />,
    },
    {
      value: 'title-desc',
      label: t('library_sort_za'),
      icon: <ArrowUpAZ className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center border-b border-library-line px-5 sm:px-7">
        <label className="library-input-frame flex h-9 w-full items-center gap-2.5 bg-library-canvas px-3 text-library-muted focus-within:bg-white sm:w-1/2">
          <Search className="h-4 w-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="library-inline-input min-w-0 flex-1 text-xs"
            placeholder={t('library_search_placeholder')}
          />
        </label>
      </header>

      {error ? (
        <p
          role="alert"
          className="border-b border-ui-danger-border bg-ui-danger-soft px-7 py-2 text-xs text-ui-danger"
        >
          {t('library_read_failed')}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-[26rem] min-w-0 flex-col lg:min-h-0">
          <div className="grid shrink-0 grid-cols-1 gap-3 px-5 py-3 sm:px-7 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <h1
                  className="truncate text-xl font-semibold tracking-[-0.035em] text-library-ink"
                  title={heading.fullLabel}
                >
                  {heading.label}
                </h1>
                <span className="shrink-0 text-[11px] text-library-muted">
                  {t('library_result_count', [String(results.length)])}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
              <SelectMenu
                value={filter.kind === 'folder' ? 'all' : serializeFilter(filter)}
                options={filterOptions}
                onChange={(value) => changeFilter(parseFilter(value))}
                ariaLabel={t('library_filter')}
                triggerIcon={<ListFilter className="h-3.5 w-3.5" />}
                className="max-w-full"
              />
              <SelectMenu
                value={sort}
                options={sortOptions}
                onChange={(value) => setSort(value as LibrarySort)}
                ariaLabel={t('library_sort')}
                className="shrink-0"
              />
              {filter.kind === 'duplicates' ? (
                <button
                  type="button"
                  onClick={() => void refreshLibrary()}
                  className="library-icon-button shrink-0 border border-library-line bg-white"
                  title={t('library_refresh_duplicates')}
                  aria-label={t('library_refresh_duplicates')}
                >
                  <RefreshCw className={`h-4 w-4 ${isMutating ? 'animate-spin' : ''}`} />
                </button>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`border-y px-5 py-2 text-xs sm:px-7 ${
                notice.kind === 'error'
                  ? 'border-ui-danger-border bg-ui-danger-soft text-ui-danger'
                  : 'border-library-line bg-library-canvas text-library-muted'
              }`}
            >
              {notice.text}
            </p>
          ) : null}

          {!library ? (
            <div className="space-y-1 px-4" aria-busy="true">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-lg bg-library-canvas" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="grid min-h-80 flex-1 place-items-center px-8 text-center">
              <div>
                <Search className="mx-auto h-5 w-5 text-library-muted" />
                <h2 className="mt-3 text-sm font-semibold text-library-ink">
                  {t('library_empty_title')}
                </h2>
                <p className="mt-1 text-xs text-library-muted">{t('library_empty_hint')}</p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
              {results.slice(0, visibleLimit).map((bookmark) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  selected={bookmark.id === selectedId}
                  locale={locale}
                  resolvedDuplicate={filter.kind === 'duplicates' && bookmark.duplicateCount === 1}
                  onClick={() => selectBookmark(bookmark.id)}
                  onRename={
                    filter.kind === 'duplicates' ? () => renameBookmark(bookmark.id) : undefined
                  }
                  onDelete={(anchor) =>
                    setPendingDelete({ bookmark, presentation: 'popover', anchor })
                  }
                />
              ))}
              {visibleLimit < results.length ? (
                <button
                  type="button"
                  className="library-secondary-button my-3 w-full border-dashed"
                  onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}
                >
                  {t('library_load_more')}
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className="min-h-0 border-t border-library-line lg:border-l lg:border-t-0">
          <BookmarkEditor
            key={selected ? `${selected.id}:${editorRevision}:${localEditorRevision}` : 'empty'}
            bookmark={selected}
            folders={library?.folders ?? []}
            busy={isMutating}
            onSave={handleSave}
            onDelete={() =>
              selected && setPendingDelete({ bookmark: selected, presentation: 'dialog' })
            }
            onDirtyChange={onUnsavedDraftChange}
            focusTitleRevision={focusTitleRevision}
          />
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete?.presentation === 'dialog'}
        title={t('library_delete_confirm_title')}
        description={t('library_delete_confirm', [
          pendingDelete?.bookmark.title ||
            (pendingDelete ? getBookmarkDomain(pendingDelete.bookmark.url) : ''),
        ])}
        confirmLabel={t('library_delete_bookmark')}
        cancelLabel={t('action_cancel')}
        busy={isMutating}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmPopover
        open={pendingDelete?.presentation === 'popover'}
        anchor={pendingDelete?.presentation === 'popover' ? pendingDelete.anchor : undefined}
        title={t('library_delete_quick_confirm')}
        description={t('library_delete_quick_description')}
        confirmLabel={t('library_delete_bookmark')}
        cancelLabel={t('action_cancel')}
        busy={isMutating}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}

function BookmarkRow({
  bookmark,
  selected,
  locale,
  resolvedDuplicate,
  onClick,
  onRename,
  onDelete,
}: {
  bookmark: LocalBookmark;
  selected: boolean;
  locale: string;
  resolvedDuplicate: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete: (anchor: HTMLButtonElement) => void;
}) {
  const { t } = createTranslator();
  const visibleTags = bookmark.metadata.tags.slice(0, 2);
  const remainingTagCount = bookmark.metadata.tags.length - visibleTags.length;

  return (
    <div
      className={`group flex w-full items-center rounded-lg px-2 py-1.5 transition ${selected ? 'bg-library-selected' : 'hover:bg-library-hover'}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md">
          <BookmarkFavicon url={bookmark.url} className="h-5 w-5 object-contain" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-library-ink">
            {bookmark.title || bookmark.url}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] text-library-muted">
            <span className="shrink-0">{getBookmarkDomain(bookmark.url)}</span>
            <span className="truncate">{bookmark.folderPath || 'Chrome'}</span>
            {bookmark.dateAdded ? (
              <span className="shrink-0">
                {new Date(bookmark.dateAdded).toLocaleDateString(locale)}
              </span>
            ) : null}
          </span>
        </span>
        {visibleTags.length ? (
          <span className="flex max-w-44 shrink-0 items-center justify-end gap-1 overflow-hidden">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="max-w-20 truncate rounded-md bg-library-forest-soft px-1.5 py-1 text-[10px] font-medium text-library-muted"
                title={tag}
              >
                {tag}
              </span>
            ))}
            {remainingTagCount > 0 ? (
              <span
                className="shrink-0 text-[10px] font-medium text-library-muted"
                aria-label={t('library_more_tags', [String(remainingTagCount)])}
                title={t('library_more_tags', [String(remainingTagCount)])}
              >
                +{remainingTagCount}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <div
        className={`flex shrink-0 items-center gap-0.5 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
      >
        {resolvedDuplicate ? (
          <span className="mr-1 rounded-md bg-white px-2 py-1 text-[10px] font-medium text-library-muted">
            {t('library_duplicate_kept_badge')}
          </span>
        ) : null}
        {onRename ? (
          <button
            type="button"
            onClick={onRename}
            className="library-icon-button h-8 w-8"
            title={t('library_rename_bookmark')}
            aria-label={t('library_rename_bookmark')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => onDelete(event.currentTarget)}
          className="library-icon-button h-8 w-8 hover:bg-ui-danger-soft hover:text-ui-danger"
          title={t('library_delete_bookmark')}
          aria-label={t('library_delete_bookmark')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function createFilterOptions(
  filter: LibraryFilter,
  t: (key: string, substitutions?: string | string[]) => string,
  library: LocalLibraryController['library']
): SelectMenuOption[] {
  const options: SelectMenuOption[] = [
    { value: 'all', label: t('library_all') },
    { value: 'untagged', label: t('library_untagged') },
    { value: 'duplicates', label: t('library_duplicates') },
    { value: 'uncategorized', label: t('library_report_uncategorized') },
  ];
  if (filter.kind === 'recent') {
    options.splice(1, 0, { value: 'recent', label: t('library_recent') });
  }
  const tags = library?.tags ?? [];
  if (
    filter.kind === 'tag' &&
    !tags.some((tag) => tag.name.toLocaleLowerCase() === filter.tag.toLocaleLowerCase())
  ) {
    options.push({
      value: serializeFilter(filter),
      label: filter.tag,
      group: t('library_filter_tags'),
    });
  }
  for (const tag of tags) {
    options.push({ value: `tag:${tag.name}`, label: tag.name, group: t('library_filter_tags') });
  }
  return options;
}

function serializeFilter(filter: LibraryFilter): string {
  if (filter.kind === 'folder') return `folder:${filter.folderId}`;
  if (filter.kind === 'tag') return `tag:${filter.tag}`;
  return filter.kind;
}

function parseFilter(value: string): LibraryFilter {
  if (value.startsWith('tag:')) return { kind: 'tag', tag: value.slice(4) };
  return { kind: value as Exclude<LibraryFilter['kind'], 'folder' | 'tag'> };
}

function collectDuplicateIds(library: NonNullable<LocalLibraryController['library']>): Set<string> {
  return new Set(
    library.duplicateGroups.flatMap((group) => group.bookmarks.map((bookmark) => bookmark.id))
  );
}

function getViewHeading(
  filter: LibraryFilter,
  t: (key: string, substitutions?: string | string[]) => string,
  library: LocalLibraryController['library']
): { label: string; fullLabel: string } {
  const fullLabel = filterLabel(filter, t, library);
  if (filter.kind !== 'folder') return { label: fullLabel, fullLabel };

  const folder = library?.folders.find((candidate) => candidate.id === filter.folderId);
  if (!folder) return { label: fullLabel, fullLabel };
  return {
    label: folder.title,
    fullLabel: folder.path,
  };
}

function filterLabel(
  filter: LibraryFilter,
  t: (key: string, substitutions?: string | string[]) => string,
  library: LocalLibraryController['library']
): string {
  if (filter.kind === 'recent') return t('library_recent');
  if (filter.kind === 'untagged') return t('library_untagged');
  if (filter.kind === 'duplicates') return t('library_duplicates');
  if (filter.kind === 'uncategorized') return t('library_report_uncategorized');
  if (filter.kind === 'tag') return filter.tag;
  if (filter.kind === 'folder') {
    return (
      library?.folders.find((folder) => folder.id === filter.folderId)?.path ?? t('library_folders')
    );
  }
  return t('library_all');
}
