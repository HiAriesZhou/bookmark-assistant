import { ExternalLink, Save, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  BOOKMARK_DESCRIPTION_MAX_LENGTH,
  BOOKMARK_TAG_LIMIT,
  BOOKMARK_TAG_MAX_LENGTH,
  normalizeBookmarkTags,
} from '../../library/bookmark-metadata';
import type { BookmarkChanges } from '../../library/bookmark-actions';
import {
  getBookmarkDomain,
  type LocalBookmark,
  type LocalBookmarkFolder,
} from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import { useToast } from '../hook/useToast';
import { BookmarkFavicon } from './BookmarkFavicon';
import { SelectMenu } from './SelectMenu';

export function BookmarkEditor({
  bookmark,
  folders,
  busy,
  onSave,
  onDelete,
  onDirtyChange,
  focusTitleRevision = 0,
}: {
  bookmark?: LocalBookmark;
  folders: LocalBookmarkFolder[];
  busy: boolean;
  onSave: (changes: BookmarkChanges) => Promise<void>;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  focusTitleRevision?: number;
}) {
  const { t } = createTranslator();
  const { show } = useToast();
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [description, setDescription] = useState(bookmark?.metadata.description ?? '');
  const [tags, setTags] = useState(bookmark?.metadata.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [parentId, setParentId] = useState(bookmark?.parentId ?? '');
  const [dirty, setDirty] = useState(false);
  const draftRevision = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bookmarkId = bookmark?.id;

  useEffect(() => {
    if (!bookmark || dirty) return;
    setTitle(bookmark.title);
    setUrl(bookmark.url);
    setDescription(bookmark.metadata.description ?? '');
    setTags(bookmark.metadata.tags);
    setTagDraft('');
    setParentId(bookmark.parentId ?? '');
  }, [bookmark, dirty]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!bookmarkId || focusTitleRevision === 0) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [bookmarkId, focusTitleRevision]);

  const markDirty = () => {
    draftRevision.current += 1;
    setDirty(true);
  };

  if (!bookmark) {
    return (
      <aside className="flex h-full min-h-[20rem] items-center justify-center bg-library-paper px-8 text-center">
        <div>
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-library-line bg-white text-library-muted">
            <ExternalLink className="h-4 w-4" />
          </div>
          <p className="mt-3 text-sm font-semibold text-library-ink">
            {t('library_select_bookmark')}
          </p>
          <p className="mt-1 text-xs leading-5 text-library-muted">
            {t('library_select_bookmark_hint')}
          </p>
        </div>
      </aside>
    );
  }

  const addTags = () => {
    let nextTags: string[];
    try {
      nextTags = mergeTagDraft(tags, tagDraft);
    } catch {
      show({ variant: 'error', title: t('library_tag_limit_error') });
      return;
    }
    if (nextTags === tags) {
      setTagDraft('');
      return;
    }
    setTags(nextTags);
    markDirty();
    setTagDraft('');
  };

  const save = async () => {
    let tagsToSave: string[];
    try {
      tagsToSave = mergeTagDraft(tags, tagDraft);
    } catch {
      show({ variant: 'error', title: t('library_tag_limit_error') });
      return;
    }
    if (tagsToSave !== tags) {
      setTags(tagsToSave);
    }
    if (tagDraft) setTagDraft('');
    const savedRevision = draftRevision.current;
    try {
      await onSave({ title, url, description, tags: tagsToSave, parentId });
      if (draftRevision.current === savedRevision) {
        setDirty(false);
        show({
          id: 'bookmark-save-feedback',
          variant: 'success',
          title: t('library_saved_locally'),
          duration: 2200,
        });
      } else {
        show({
          id: 'bookmark-save-feedback',
          variant: 'success',
          title: t('library_saved_older_changes'),
          duration: 3200,
        });
      }
    } catch {
      show({ variant: 'error', title: t('library_save_failed') });
    }
  };

  const domain = getBookmarkDomain(bookmark.url);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-library-paper">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-library-line px-5">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-library-muted">
          {t('library_bookmark_details')}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => window.open(bookmark.url, '_blank', 'noopener,noreferrer')}
            className="library-icon-button"
            title={t('library_open_bookmark')}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white">
            <BookmarkFavicon url={bookmark.url} className="h-6 w-6 object-contain" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold tracking-[-0.025em] text-library-ink">
              {bookmark.title}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-library-muted">{domain}</p>
          </div>
        </div>

        <EditorField label={t('library_field_title')}>
          <input
            ref={titleInputRef}
            className="library-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
          />
        </EditorField>
        <EditorField label={t('library_field_url')}>
          <input
            className="library-input"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              markDirty();
            }}
          />
        </EditorField>
        <EditorField label={t('library_field_description')} hint={t('library_local_only')}>
          <textarea
            className="library-input h-16 min-h-16 resize-y py-2"
            maxLength={BOOKMARK_DESCRIPTION_MAX_LENGTH}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              markDirty();
            }}
          />
        </EditorField>
        <EditorField label={t('library_field_tags')} hint={t('library_tag_separator_hint')}>
          <div className="library-input-frame flex min-h-9 flex-wrap items-center gap-1.5 px-2 py-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-library-forest-soft px-2 py-1 text-[11px] font-medium text-library-forest"
              >
                {tag}
                <button
                  type="button"
                  aria-label={t('library_remove_tag', [tag])}
                  onClick={() => {
                    setTags(tags.filter((value) => value !== tag));
                    markDirty();
                  }}
                  className="text-library-muted hover:text-library-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              className="library-inline-input min-w-20 flex-1 px-1 py-1 text-xs"
              maxLength={BOOKMARK_TAG_LIMIT * (BOOKMARK_TAG_MAX_LENGTH + 1)}
              placeholder={t('library_add_tag')}
              value={tagDraft}
              onChange={(event) => {
                setTagDraft(event.target.value);
                markDirty();
              }}
              onBlur={addTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTags();
                }
              }}
            />
          </div>
        </EditorField>
        <EditorField label={t('library_field_folder')}>
          <SelectMenu
            value={parentId}
            onChange={(value) => {
              setParentId(value);
              markDirty();
            }}
            ariaLabel={t('library_field_folder')}
            options={folders.map((folder) => ({
              value: folder.id,
              label: folder.path,
            }))}
          />
        </EditorField>
        <div className="pt-1">
          <div className="flex min-h-9 items-center justify-between">
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="library-icon-button hover:bg-ui-danger-soft hover:text-ui-danger"
              title={t('library_delete_bookmark')}
              aria-label={t('library_delete_bookmark')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void save()}
              className="library-icon-button bg-library-ink text-white hover:bg-ui-control-hover hover:text-white disabled:bg-ui-control-disabled disabled:text-ui-disabled"
              title={busy ? t('saving') : t('library_save_changes')}
              aria-label={busy ? t('saving') : t('library_save_changes')}
            >
              <Save className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function mergeTagDraft(tags: string[], draft: string): string[] {
  const candidates = draft
    .split(/[,，]/)
    .map((tag) => tag.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!candidates.length) return tags;
  const merged = normalizeBookmarkTags([...tags, ...candidates]);
  return merged.length === tags.length ? tags : merged;
}

function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-library-ink">
        {label}
        {hint ? <span className="font-normal text-library-muted">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
