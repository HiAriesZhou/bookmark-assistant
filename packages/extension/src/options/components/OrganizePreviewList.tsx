import { ArrowRight } from 'lucide-react';
import { groupOrganizeProposals, type OrganizeFolder } from '../../core';
import { getBookmarkDomain, type LocalBookmark } from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import type { ReviewedProposal } from '../hook/useLibraryOrganize';
import { SelectMenu } from './SelectMenu';

export function OrganizePreviewList({
  proposals,
  folders,
  bookmarksById,
  folderPathById,
  onChange,
}: {
  proposals: ReviewedProposal[];
  folders: OrganizeFolder[];
  bookmarksById: Map<string, LocalBookmark>;
  folderPathById: Map<string, string>;
  onChange: (bookmarkId: string, changes: Partial<ReviewedProposal>) => void;
}) {
  const { t } = createTranslator();
  const folderOptions = folders.map((folder) => ({ value: folder.id, label: folder.path }));
  const groups = groupOrganizeProposals(proposals, folders);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.folderId} aria-label={folderPathById.get(group.folderId)}>
          <h3 className="mb-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-library-muted">
            {folderPathById.get(group.folderId) ?? group.folderId}
          </h3>
          <ul className="divide-y divide-library-line rounded-xl border border-library-line">
            {group.proposals.map((proposal) => {
              const bookmark = bookmarksById.get(proposal.bookmarkId);
              const title = bookmark?.title || (bookmark ? getBookmarkDomain(bookmark.url) : '');
              return (
                <li key={proposal.bookmarkId} className="flex items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-library-forest"
                    checked={proposal.selected}
                    onChange={(event) =>
                      onChange(proposal.bookmarkId, { selected: event.target.checked })
                    }
                    aria-label={t('organize_select_bookmark', [title])}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[13px] font-semibold text-library-ink"
                      title={title}
                    >
                      {title}
                    </p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-library-muted">
                      <span className="max-w-[45%] truncate">
                        {folderPathById.get(proposal.fromParentId) ?? bookmark?.folderPath}
                      </span>
                      <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0" />
                      <SelectMenu
                        value={proposal.toFolderId}
                        options={folderOptions}
                        onChange={(value) => onChange(proposal.bookmarkId, { toFolderId: value })}
                        ariaLabel={t('organize_target_folder', [title])}
                        className="min-w-0 max-w-[50%]"
                      />
                    </div>
                    {proposal.reason ? (
                      <p className="mt-1 text-[11px] leading-4 text-library-muted">
                        {proposal.reason}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
