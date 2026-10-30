import { ChevronRight, Folder, FolderPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getBookmarkDomain, type LocalBookmark } from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import type { OrganizeTargetOption, ReviewedProposal } from '../hook/useLibraryOrganize';
import {
  buildPreviewTree,
  previewFolderCount,
  type PreviewFolderNode,
} from '../organize-preview-tree';
import { BookmarkFavicon } from './BookmarkFavicon';
import { SelectMenu } from './SelectMenu';

const INDENT_PX = 16;

type Translate = ReturnType<typeof createTranslator>['t'];

interface TreeContext {
  t: Translate;
  bookmarksById: Map<string, LocalBookmark>;
  folderPathById: Map<string, string>;
  folderOptions: Array<{ value: string; label: string }>;
  onChange: (bookmarkId: string, changes: Partial<ReviewedProposal>) => void;
}

/** The changed part of the library, shown as it will look after the selected moves. */
export function OrganizePreviewTree({
  proposals,
  targets,
  newFolderTitles,
  folders,
  bookmarks,
  bookmarksById,
  folderPathById,
  onChange,
}: {
  proposals: ReviewedProposal[];
  targets: OrganizeTargetOption[];
  newFolderTitles: Record<string, string>;
  folders: Array<{ id: string; parentId?: string; title: string }>;
  bookmarks: LocalBookmark[];
  bookmarksById: Map<string, LocalBookmark>;
  folderPathById: Map<string, string>;
  onChange: (bookmarkId: string, changes: Partial<ReviewedProposal>) => void;
}) {
  const { t } = createTranslator();
  const categoryTargetCount = targets.filter((target) => target.isCategory).length;
  const barId = folders.find((folder) => folder.parentId === '0')?.id ?? '1';
  const tree = useMemo(
    () => buildPreviewTree({ folders, bookmarks, proposals, newFolderTitles, barId }),
    [folders, bookmarks, proposals, newFolderTitles, barId]
  );
  const context: TreeContext = {
    t,
    bookmarksById,
    folderPathById,
    folderOptions: targets.map((target, index) => ({
      value: target.value,
      label: target.isNew ? `${target.label} · ${t('organize_new_folder')}` : target.label,
      group:
        index < categoryTargetCount ? t('organize_target_categories') : t('organize_target_other'),
    })),
    onChange,
  };

  return (
    <ul role="tree" aria-label={t('organize_preview_tree')} className="text-[13px]">
      {tree.map((node) => (
        <FolderBranch key={node.id} node={node} depth={0} context={context} />
      ))}
    </ul>
  );
}

function FolderBranch({
  node,
  depth,
  context,
}: {
  node: PreviewFolderNode<ReviewedProposal>;
  depth: number;
  context: TreeContext;
}) {
  const { t } = context;
  const [open, setOpen] = useState(true);
  const count = previewFolderCount(node);
  const FolderIcon = node.isNew ? FolderPlus : Folder;

  return (
    <li role="treeitem" aria-expanded={open} aria-label={node.title}>
      <div
        className="flex h-8 items-center gap-1.5 rounded-md pr-2 hover:bg-library-hover"
        style={{ paddingLeft: depth * INDENT_PX }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="grid h-6 w-5 shrink-0 place-items-center rounded text-library-muted"
          aria-label={node.title}
        >
          <ChevronRight
            aria-hidden="true"
            className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <FolderIcon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${node.isNew ? 'text-library-forest' : 'text-library-muted'}`}
        />
        <span className="min-w-0 truncate font-medium text-library-ink">{node.title}</span>
        {node.isNew ? (
          <span className="shrink-0 rounded-full bg-library-forest-soft px-1.5 py-px text-[10px] font-medium text-library-forest">
            {t('organize_new_folder')}
          </span>
        ) : null}
        {count > 0 || !node.children.length ? (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-library-faint">
            {count}
          </span>
        ) : null}
      </div>
      {open ? (
        <ul role="group">
          {node.keptCount > 0 ? (
            <li
              className="flex h-7 items-center text-[11px] text-library-faint"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 26 }}
            >
              {t('organize_preview_kept', [String(node.keptCount)])}
            </li>
          ) : count === 0 && !node.children.length ? (
            <li
              className="flex h-7 items-center text-[11px] text-library-faint"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 26 }}
            >
              {t('organize_preview_empty_after')}
            </li>
          ) : null}
          {node.children.map((child) => (
            <FolderBranch key={child.id} node={child} depth={depth + 1} context={context} />
          ))}
          {node.incoming.map((proposal) => (
            <BookmarkRow
              key={proposal.bookmarkId}
              proposal={proposal}
              depth={depth + 1}
              context={context}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BookmarkRow({
  proposal,
  depth,
  context,
}: {
  proposal: ReviewedProposal;
  depth: number;
  context: TreeContext;
}) {
  const { t, bookmarksById, folderPathById, folderOptions, onChange } = context;
  const bookmark = bookmarksById.get(proposal.bookmarkId);
  const title = bookmark?.title || (bookmark ? getBookmarkDomain(bookmark.url) : '');
  const from = folderPathById.get(proposal.fromParentId) ?? bookmark?.folderPath ?? '';

  return (
    <li
      role="treeitem"
      aria-selected={proposal.selected}
      className="flex items-start gap-2 rounded-md py-1.5 pr-2 hover:bg-library-hover"
      style={{ paddingLeft: depth * INDENT_PX + 4 }}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-library-forest"
        checked={proposal.selected}
        onChange={(event) => onChange(proposal.bookmarkId, { selected: event.target.checked })}
        aria-label={t('organize_select_bookmark', [title])}
      />
      {bookmark ? (
        <BookmarkFavicon url={bookmark.url} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : null}
      <div className={`min-w-0 flex-1 ${proposal.selected ? '' : 'opacity-55'}`}>
        <p className="truncate text-library-ink" title={title}>
          {title}
        </p>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-library-muted">
          {!proposal.confident ? (
            <span className="font-medium text-ui-warning">{t('organize_low_confidence')} · </span>
          ) : null}
          {proposal.selected
            ? t('organize_preview_from', [from])
            : t('organize_preview_stays', [from])}
          {proposal.reason ? ` · ${proposal.reason}` : ''}
        </p>
      </div>
      <SelectMenu
        value={proposal.toFolderId}
        options={folderOptions}
        onChange={(value) => onChange(proposal.bookmarkId, { toFolderId: value })}
        ariaLabel={t('organize_target_folder', [title])}
        compactLabel={t('organize_change_target')}
        className="shrink-0"
      />
    </li>
  );
}
