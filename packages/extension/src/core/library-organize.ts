// Pure planning, prompt and response handling for AI library organization.
// Chrome reads, provider calls and bookmark moves live outside core.

export const ORGANIZE_MAX_ITEMS = 300;
// Small batches keep each provider call well inside the worker's ~30 s fetch window.
export const ORGANIZE_BATCH_SIZE = 20;
export const ORGANIZE_MAX_FOLDERS = 300;
// Common local and private-network names. Internal hosts on public domains cannot be detected.
const PRIVATE_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.test',
  '.lan',
  '.home',
  '.home.arpa',
  '.intranet',
  '.localdomain',
  '.corp',
];
const TITLE_MAX_LENGTH = 200;

export interface OrganizeBookmarkInput {
  id: string;
  parentId?: string;
  title: string;
  url: string;
  dateAdded?: number;
  folderPath: string;
  isTopLevel: boolean;
  unmodifiable?: boolean;
}

export interface OrganizeFolderInput {
  id: string;
  parentId?: string;
  path: string;
  unmodifiable?: boolean;
}

export interface OrganizeItem {
  id: string;
  parentId: string;
  title: string;
  /** Origin and path only; queries and fragments can carry credentials. */
  url: string;
  folderPath: string;
  /** The category its current folder already serves, when that folder is mapped. */
  currentCategory?: string;
}

export interface OrganizeFolder {
  id: string;
  parentId?: string;
  path: string;
}

export interface OrganizeScope {
  items: OrganizeItem[];
  folders: OrganizeFolder[];
  totalCandidates: number;
  /** Managed bookmarks and private or non-web URLs never leave the device. */
  excludedCount: number;
}

export interface OrganizeBatch {
  items: OrganizeItem[];
}

export class OrganizeResponseError extends Error {
  constructor() {
    super('The model did not return a valid organization plan.');
    this.name = 'OrganizeResponseError';
  }
}

export function toShareableBookmarkUrl(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return undefined;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isPrivateHostname(hostname)) return undefined;
  return `${url.origin}${url.pathname}`;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname.startsWith('[')) return isPrivateIpv6(hostname.slice(1, -1));
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return isPrivateIpv4(hostname);
  return (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function isPrivateIpv4(address: string): boolean {
  const [first, second] = address.split('.').map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateIpv6(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // URL normalizes mapped IPv4 to hexadecimal groups; treat every mapped form as private.
  if (address.startsWith('::ffff:')) return true;
  return (
    address === '::1' ||
    address === '::' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80:')
  );
}

export function planOrganizeScope(
  bookmarks: OrganizeBookmarkInput[],
  folders: OrganizeFolderInput[]
): OrganizeScope {
  const eligible: Array<OrganizeItem & { isTopLevel: boolean; dateAdded: number }> = [];
  for (const bookmark of bookmarks) {
    const url = toShareableBookmarkUrl(bookmark.url);
    if (!url || bookmark.unmodifiable || !bookmark.parentId) continue;
    eligible.push({
      id: bookmark.id,
      parentId: bookmark.parentId,
      title: bookmark.title.slice(0, TITLE_MAX_LENGTH),
      url,
      folderPath: bookmark.folderPath,
      isTopLevel: bookmark.isTopLevel,
      dateAdded: bookmark.dateAdded ?? 0,
    });
  }

  const items = [...eligible]
    .sort(
      (left, right) =>
        Number(right.isTopLevel) - Number(left.isTopLevel) || right.dateAdded - left.dateAdded
    )
    .slice(0, ORGANIZE_MAX_ITEMS)
    .map(({ isTopLevel: _isTopLevel, dateAdded: _dateAdded, ...item }) => item);

  return {
    items,
    folders: selectTargetFolders(bookmarks, folders),
    totalCandidates: bookmarks.length,
    excludedCount: bookmarks.length - eligible.length,
  };
}

/** Every folder a bookmark could move into, busiest first. Categories live library-wide. */
function selectTargetFolders(
  bookmarks: OrganizeBookmarkInput[],
  folders: OrganizeFolderInput[]
): OrganizeFolder[] {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    if (bookmark.parentId) counts.set(bookmark.parentId, (counts.get(bookmark.parentId) ?? 0) + 1);
  }
  return folders
    .map((folder, order) => ({ folder, order }))
    .filter(({ folder }) => !folder.unmodifiable)
    .sort(
      (left, right) =>
        (counts.get(right.folder.id) ?? 0) - (counts.get(left.folder.id) ?? 0) ||
        left.order - right.order
    )
    .slice(0, ORGANIZE_MAX_FOLDERS)
    .map(({ folder }) => ({ id: folder.id, parentId: folder.parentId, path: folder.path }));
}

export function chunkOrganizeItems<T>(items: T[], size = ORGANIZE_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

export function groupOrganizeProposals<T extends { toFolderId: string }>(
  proposals: T[],
  folders: Array<{ id: string }>
): Array<{ folderId: string; proposals: T[] }> {
  const order = new Map(folders.map((folder, index) => [folder.id, index]));
  const groups = new Map<string, T[]>();
  for (const proposal of proposals) {
    groups.set(proposal.toFolderId, [...(groups.get(proposal.toFolderId) ?? []), proposal]);
  }
  return [...groups.entries()]
    .sort(
      ([left], [right]) =>
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    )
    .map(([folderId, grouped]) => ({ folderId, proposals: grouped }));
}
