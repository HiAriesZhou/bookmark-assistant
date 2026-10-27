import { ChevronRight, Clock3, Cloud, Folder, Library, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { LibraryFilter, LocalBookmarkIndex } from '../../library/bookmark-library';
import { createTranslator } from '../../utils/i18n';
import logoUrl from '@product-logo';
import { productConfig } from '../../product-config';
import { selectPlanPending, useAppStore } from '../store';
import type { RouteId } from '../router';

export function Sidebar({
  active,
  library,
  filter,
  onNavigate,
  onFilterChange,
}: {
  active: RouteId;
  library?: LocalBookmarkIndex;
  filter: LibraryFilter;
  onNavigate: (to: RouteId) => void;
  onFilterChange: (filter: LibraryFilter) => void;
}) {
  const { t } = createTranslator();
  const version = globalThis.chrome?.runtime?.getManifest?.()?.version || '—';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const folders = library?.folders ?? [];
  let hiddenBelow: number | undefined;
  const visibleFolders = folders.flatMap((folder, index) => {
    if (hiddenBelow !== undefined && folder.depth > hiddenBelow) return [];
    hiddenBelow = undefined;
    const hasChildren = (folders[index + 1]?.depth ?? -1) > folder.depth;
    if (hasChildren && collapsed.has(folder.id)) hiddenBelow = folder.depth;
    return [{ folder, hasChildren }];
  });

  return (
    <aside className="flex shrink-0 flex-col border-b border-library-line bg-library-sidebar text-library-ink md:h-full md:w-[232px] md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:py-5">
        <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold tracking-[-0.02em]">
            {productConfig.name}
          </div>
          <div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-library-muted">
            {t('library_eyebrow')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 px-3 pb-3 md:block md:space-y-1">
        <SidebarButton
          active={active === 'library' && filter.kind === 'all'}
          icon={<Library />}
          label={t('library_all')}
          count={library?.bookmarks.length}
          onClick={() => onFilterChange({ kind: 'all' })}
        />
        <SidebarButton
          active={active === 'library' && filter.kind === 'recent'}
          icon={<Clock3 />}
          label={t('library_recent')}
          onClick={() => onFilterChange({ kind: 'recent' })}
        />
      </div>

      <div className="hidden min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:block">
        <p className="mb-2 mt-5 px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-library-faint">
          {t('library_folders')}
        </p>
        <div className="space-y-0.5">
          {visibleFolders.map(({ folder, hasChildren }) => (
            <div
              key={folder.id}
              className="flex items-center"
              style={{ paddingLeft: `${Math.min(folder.depth, 4) * 14}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="grid h-9 w-5 shrink-0 place-items-center rounded-md text-library-muted hover:bg-library-hover"
                  aria-label={t(
                    collapsed.has(folder.id) ? 'library_expand_folder' : 'library_collapse_folder',
                    [folder.title]
                  )}
                  aria-expanded={!collapsed.has(folder.id)}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(folder.id)) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`h-3 w-3 transition-transform ${collapsed.has(folder.id) ? '' : 'rotate-90'}`}
                  />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <SidebarButton
                active={
                  active === 'library' && filter.kind === 'folder' && filter.folderId === folder.id
                }
                icon={<Folder />}
                label={folder.title || folder.path}
                onClick={() => onFilterChange({ kind: 'folder', folderId: folder.id })}
              />
            </div>
          ))}
        </div>
      </div>

      <nav
        className="grid grid-cols-2 gap-1 border-t border-library-line px-3 py-3 md:block md:space-y-1 md:border-0"
        aria-label={t('primary_navigation')}
      >
        <SidebarButton
          active={active === 'destinations'}
          icon={<Cloud />}
          label={t('nav_destinations')}
          onClick={() => onNavigate('destinations')}
        />
        <AccountEntry active={active === 'settings'} onClick={() => onNavigate('settings')} />
      </nav>

      <div className="hidden items-center justify-between px-5 pb-4 text-[9px] text-library-faint md:flex">
        <span>v{version}</span>
        <span>{t('library_local_ready')}</span>
      </div>
    </aside>
  );
}

function selfHostedServerName() {
  try {
    return new URL(productConfig.apiUrl).hostname;
  } catch {
    return '';
  }
}

/** Account entry for the settings route; plan and identity come from server-backed store state. */
function AccountEntry({ active, onClick }: { active: boolean; onClick: () => void }) {
  const { t } = createTranslator();
  const isSignedIn = useAppStore((state) => state.isSignedIn);
  const userEmail = useAppStore((state) => state.userEmail);
  const isPro = useAppStore((state) => state.isPro);
  const selfHosted = useAppStore((state) => state.deploymentMode === 'self-hosted');
  const planPending = useAppStore(selectPlanPending);
  const workspaceName = useAppStore((state) => state.dashboard?.connection.workspaceName);
  // Accounts created through Notion may not have an email yet.
  const name = userEmail || workspaceName || t('account_notion_fallback');
  const plan = selfHosted
    ? t('account_plan_self_hosted')
    : isPro
      ? t('account_plan_pro')
      : t('account_plan_free');
  const serverName = selfHosted ? selfHostedServerName() : '';

  // One row, like the other sidebar items: avatar, name, and the plan as a trailing pill.
  // Secondary details move into the tooltip so the entry keeps the 36px row height.
  const tooltip = isSignedIn
    ? [name, serverName].filter(Boolean).join(' · ')
    : t('account_local_no_account');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={tooltip}
      className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-lg pl-2.5 pr-2 text-left text-[11px] transition ${active ? 'bg-library-selected text-library-ink' : 'text-library-muted hover:bg-library-hover hover:text-library-ink'}`}
    >
      <span
        aria-hidden="true"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-library-line bg-white text-[9px] font-semibold uppercase text-library-ink [&>svg]:h-3 [&>svg]:w-3"
      >
        {isSignedIn && userEmail ? userEmail.charAt(0) : <UserRound />}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${isSignedIn || active ? 'font-semibold text-library-ink' : ''}`}
      >
        {isSignedIn ? name : t('account_login')}
      </span>
      {/* Keeps the hint in the accessible name, which also tells it apart from the form's submit button. */}
      {isSignedIn ? null : <span className="sr-only">{t('account_local_no_account')}</span>}
      {isSignedIn ? (
        planPending && !selfHosted ? (
          <span
            aria-hidden="true"
            className="h-4 w-8 shrink-0 rounded-full bg-library-line motion-safe:animate-pulse"
          />
        ) : (
          <span className="inline-flex h-4 shrink-0 items-center rounded-full border border-library-line px-1.5 text-[9px] font-semibold text-library-muted">
            {plan}
          </span>
        )
      ) : null}
    </button>
  );
}

function SidebarButton({
  active,
  icon,
  label,
  count,
  indent = 0,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  indent?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: `${12 + indent * 14}px` }}
      className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-lg pr-2 text-left text-[11px] transition ${active ? 'bg-library-selected font-semibold text-library-ink' : 'text-library-muted hover:bg-library-hover hover:text-library-ink'}`}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-[9px] text-library-faint">{count}</span> : null}
    </button>
  );
}
