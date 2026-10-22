import { describe, expect, it } from 'vitest';
import {
  ORGANIZE_MAX_FOLDERS,
  ORGANIZE_MAX_ITEMS,
  OrganizeResponseError,
  buildOrganizePrompt,
  chunkOrganizeItems,
  hasOrganizeTargets,
  groupOrganizeProposals,
  parseOrganizeResponse,
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

  it('limits target folders to the scope subtree and never offers managed folders', () => {
    const scope = planOrganizeScope([bookmark({ id: '1', parentId: '11' })], folders, {
      scopeFolderId: '11',
    });
    expect(scope.folders.map((folder) => folder.id)).toEqual(['11', '12']);

    const all = planOrganizeScope([bookmark({ id: '1' })], folders);
    expect(all.folders.map((folder) => folder.id)).not.toContain('90');
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

describe('hasOrganizeTargets', () => {
  const item = { id: 'a', parentId: '11', title: '', url: 'https://a.example/', folderPath: '' };

  it('is false when the only folder is where every item already is', () => {
    expect(hasOrganizeTargets({ items: [item], folders: [{ id: '11', path: 'Leaf' }] })).toBe(
      false
    );
    expect(hasOrganizeTargets({ items: [item], folders: [] })).toBe(false);
  });

  it('is true when some item could move', () => {
    expect(
      hasOrganizeTargets({
        items: [item],
        folders: [
          { id: '11', path: 'Leaf' },
          { id: '12', path: 'Other' },
        ],
      })
    ).toBe(true);
  });
});

describe('chunkOrganizeItems', () => {
  it('splits items into fixed-size batches', () => {
    expect(chunkOrganizeItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('organize prompt and response', () => {
  const batch = {
    items: [
      {
        id: '100',
        parentId: '1',
        title: 'Figma tips',
        url: 'https://figma.com/blog',
        folderPath: 'Bookmarks Bar',
      },
      {
        id: '101',
        parentId: '10',
        title: 'Spacing',
        url: 'https://design.example/spacing',
        folderPath: 'Bookmarks Bar / Design',
      },
    ],
    folders: [
      { id: '10', path: 'Bookmarks Bar / Design' },
      { id: '11', path: 'Bookmarks Bar / Engineering' },
    ],
  };

  it('describes items and folders by short aliases without Chrome ids', () => {
    const prompt = buildOrganizePrompt(batch, 'zh-CN');
    expect(prompt).toContain('"b1"');
    expect(prompt).toContain('"f2"');
    expect(prompt).toContain('Figma tips');
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).not.toContain('"100"');
  });

  it('maps valid moves back to bookmarks and folders', () => {
    const result = parseOrganizeResponse(
      '```json\n{"moves":[{"item":"b1","folder":"f1","reason":"Design tooling"}]}\n```',
      batch
    );
    expect(result.proposals).toEqual([
      { bookmarkId: '100', fromParentId: '1', toFolderId: '10', reason: 'Design tooling' },
    ]);
    expect(result.discardedCount).toBe(0);
  });

  it('discards unknown aliases, no-op moves and repeated items', () => {
    const result = parseOrganizeResponse(
      JSON.stringify({
        moves: [
          { item: 'b9', folder: 'f1' },
          { item: 'b1', folder: 'f9' },
          { item: 'b2', folder: 'f1' },
          { item: 'b1', folder: 'f2', reason: 'x'.repeat(500) },
          { item: 'b1', folder: 'f1' },
          'garbage',
        ],
      }),
      batch
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ bookmarkId: '100', toFolderId: '11' });
    expect(result.proposals[0].reason.length).toBeLessThanOrEqual(120);
    expect(result.discardedCount).toBe(5);
  });

  it('treats an empty move list as keeping everything in place', () => {
    expect(parseOrganizeResponse('{"moves":[]}', batch).proposals).toEqual([]);
  });

  it.each(['not json', '{"moves":', '{"other":[]}', '[]'])(
    'rejects malformed output %s',
    (text) => {
      expect(() => parseOrganizeResponse(text, batch)).toThrow(OrganizeResponseError);
    }
  );
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
