import { describe, expect, it } from 'vitest';
import {
  ORGANIZE_MAX_FOLDERS,
  ORGANIZE_MAX_ITEMS,
  chunkOrganizeItems,
  groupOrganizeProposals,
  planOrganizeScope,
  toShareableBookmarkUrl,
  type OrganizeBookmarkInput,
  type OrganizeFolderInput,
} from './library-organize';

const folders: OrganizeFolderInput[] = [
  { id: '1', path: 'Bookmarks Bar' },
  { id: '10', parentId: '1', path: 'Bookmarks Bar / Design' },
  { id: '11', parentId: '1', path: 'Bookmarks Bar / Engineering' },
  { id: '12', parentId: '11', path: 'Bookmarks Bar / Engineering / Chrome' },
  { id: '2', path: 'Other Bookmarks' },
  { id: '90', parentId: '2', path: 'Other Bookmarks / Managed', unmodifiable: true },
];

function bookmark(overrides: Partial<OrganizeBookmarkInput> & { id: string }) {
  return {
    parentId: '1',
    title: `Bookmark ${overrides.id}`,
    url: `https://example.com/${overrides.id}`,
    folderPath: 'Bookmarks Bar',
    isTopLevel: true,
    dateAdded: Number(overrides.id),
    ...overrides,
  } satisfies OrganizeBookmarkInput;
}

describe('toShareableBookmarkUrl', () => {
  it('keeps only the origin and path of public web pages', () => {
    expect(toShareableBookmarkUrl('https://docs.example.com/a/b?token=secret#frag')).toBe(
      'https://docs.example.com/a/b'
    );
  });

  it.each([
    'http://localhost:3000/admin',
    'http://intranet/wiki',
    'https://wiki.internal/page',
    'https://printer.local/',
    'https://site.test/',
    'http://nas.lan/',
    'http://router.home.arpa/',
    'https://wiki.corp/',
    'https://portal.intranet/',
    'http://box.localdomain/',
    'http://10.1.2.3/router',
    'http://192.168.0.1/',
    'http://172.20.0.5/',
    'http://169.254.1.1/',
    'http://100.64.0.1/',
    'http://127.0.0.1:8080/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'https://user:pass@example.com/',
    'file:///Users/me/notes.html',
    'chrome://settings',
    'javascript:alert(1)',
    'not a url',
  ])('withholds %s', (url) => {
    expect(toShareableBookmarkUrl(url)).toBeUndefined();
  });
});

describe('planOrganizeScope', () => {
  it('excludes managed and private bookmarks and reports how many were withheld', () => {
    const scope = planOrganizeScope(
      [
        bookmark({ id: '1' }),
        bookmark({ id: '2', url: 'http://localhost/x' }),
        bookmark({ id: '3', unmodifiable: true }),
      ],
      folders
    );

    expect(scope.items.map((item) => item.id)).toEqual(['1']);
    expect(scope.items[0]).toMatchObject({ url: 'https://example.com/1', parentId: '1' });
    expect(scope.excludedCount).toBe(2);
    expect(scope.totalCandidates).toBe(3);
  });

  it('prefers uncategorized bookmarks, then the newest, within the item limit', () => {
    const bookmarks = Array.from({ length: ORGANIZE_MAX_ITEMS + 5 }, (_, index) =>
      bookmark({
        id: String(index + 1),
        isTopLevel: index === 0,
        parentId: index === 0 ? '1' : '10',
      })
    );
    const scope = planOrganizeScope(bookmarks, folders);

    expect(scope.items).toHaveLength(ORGANIZE_MAX_ITEMS);
    expect(scope.items[0].id).toBe('1');
    expect(scope.items[1].id).toBe(String(ORGANIZE_MAX_ITEMS + 5));
    expect(scope.totalCandidates).toBe(ORGANIZE_MAX_ITEMS + 5);
  });

  it('offers every folder in the library except managed ones', () => {
    const scope = planOrganizeScope([bookmark({ id: '1', parentId: '11' })], folders);
    expect(scope.folders.map((folder) => folder.id)).toEqual(['11', '1', '10', '12', '2']);
    expect(scope.folders.find((folder) => folder.id === '12')?.parentId).toBe('11');
  });

  it('keeps the most used folders when the folder list is too long', () => {
    const many: OrganizeFolderInput[] = Array.from(
      { length: ORGANIZE_MAX_FOLDERS + 10 },
      (_, index) => ({ id: `f${index}`, parentId: '1', path: `Bookmarks Bar / F${index}` })
    );
    const scope = planOrganizeScope(
      [bookmark({ id: '1', parentId: `f${ORGANIZE_MAX_FOLDERS + 9}` })],
      many
    );

    expect(scope.folders).toHaveLength(ORGANIZE_MAX_FOLDERS);
    expect(scope.folders[0].id).toBe(`f${ORGANIZE_MAX_FOLDERS + 9}`);
  });

  it('returns an empty scope when nothing is eligible', () => {
    expect(planOrganizeScope([], folders).items).toEqual([]);
  });
});

describe('chunkOrganizeItems', () => {
  it('splits items into fixed-size batches', () => {
    expect(chunkOrganizeItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('groupOrganizeProposals', () => {
  it('groups proposals by target folder in folder order', () => {
    const groups = groupOrganizeProposals(
      [
        { bookmarkId: 'a', fromParentId: '1', toFolderId: '11', reason: '' },
        { bookmarkId: 'b', fromParentId: '1', toFolderId: '10', reason: '' },
        { bookmarkId: 'c', fromParentId: '1', toFolderId: '11', reason: '' },
      ],
      folders
    );
    expect(groups.map((group) => [group.folderId, group.proposals.length])).toEqual([
      ['10', 1],
      ['11', 2],
    ]);
  });
});
