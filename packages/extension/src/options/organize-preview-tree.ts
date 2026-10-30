/**
 * The part of the bookmark tree an organize run changes, as it will look after applying
 * the selected moves: every target and every folder losing bookmarks, with its ancestors.
 */
export interface PreviewProposal {
  bookmarkId: string;
  fromParentId: string;
  toFolderId: string;
  selected: boolean;
}

export interface PreviewFolderNode<P extends PreviewProposal = PreviewProposal> {
  id: string;
  title: string;
  /** Created when the moves are applied. */
  isNew: boolean;
  /** Bookmarks already in the folder that stay there. */
  keptCount: number;
  /** Suggestions targeting this folder; unselected ones stay where they are. */
  incoming: P[];
  children: PreviewFolderNode<P>[];
}

export function buildPreviewTree<P extends PreviewProposal>(input: {
  folders: Array<{ id: string; parentId?: string; title: string }>;
  bookmarks: Array<{ parentId?: string }>;
  proposals: P[];
  /** Placeholder ids of new folders and their titles; they are created on the bar. */
  newFolderTitles: Record<string, string>;
  barId: string;
}): PreviewFolderNode<P>[] {
  const { folders, bookmarks, proposals, newFolderTitles, barId } = input;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const order = new Map(folders.map((folder, index) => [folder.id, index]));
  const parentOf = (id: string) => (newFolderTitles[id] ? barId : byId.get(id)?.parentId);

  const included = new Set<string>();
  const include = (id: string | undefined) => {
    while (id && !included.has(id) && (byId.has(id) || newFolderTitles[id])) {
      included.add(id);
      id = parentOf(id);
    }
  };
  for (const proposal of proposals) {
    include(proposal.toFolderId);
    if (proposal.selected) include(proposal.fromParentId);
  }

  const direct = new Map<string, number>();
  for (const bookmark of bookmarks) {
    if (bookmark.parentId) direct.set(bookmark.parentId, (direct.get(bookmark.parentId) ?? 0) + 1);
  }
  const leaving = new Map<string, number>();
  for (const proposal of proposals) {
    if (proposal.selected && proposal.toFolderId !== proposal.fromParentId) {
      leaving.set(proposal.fromParentId, (leaving.get(proposal.fromParentId) ?? 0) + 1);
    }
  }

  const nodes = new Map<string, PreviewFolderNode<P>>();
  for (const id of included) {
    nodes.set(id, {
      id,
      title: newFolderTitles[id] ?? byId.get(id)!.title,
      isNew: Boolean(newFolderTitles[id]),
      keptCount: (direct.get(id) ?? 0) - (leaving.get(id) ?? 0),
      incoming: proposals.filter((proposal) => proposal.toFolderId === id),
      children: [],
    });
  }
  const roots: PreviewFolderNode<P>[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parentOf(node.id) ?? '');
    (parent ? parent.children : roots).push(node);
  }
  // Existing folders keep Chrome's order; new folders follow them in category order.
  const rank = (node: PreviewFolderNode<P>) =>
    node.isNew
      ? folders.length + Object.keys(newFolderTitles).indexOf(node.id)
      : (order.get(node.id) ?? 0);
  const sort = (list: PreviewFolderNode<P>[]) => {
    list.sort((left, right) => rank(left) - rank(right));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

/** Bookmarks in the folder after applying, including everything selected to move in. */
export function previewFolderCount(node: PreviewFolderNode): number {
  return node.keptCount + node.incoming.filter((proposal) => proposal.selected).length;
}
