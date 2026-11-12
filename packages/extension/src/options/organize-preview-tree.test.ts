import { expect, it } from 'vitest';
import { buildPreviewTree, previewFolderCount } from './organize-preview-tree';

const folders = [
  { id: '1', parentId: '0', title: 'Bar' },
  { id: '10', parentId: '1', title: 'archive' },
  { id: '12', parentId: '10', title: 'Job' },
  { id: '13', parentId: '10', title: 'AI' },
  { id: '2', parentId: '0', title: 'Other' },
];
const bookmarks = [
  { parentId: '1' },
  { parentId: '1' },
  { parentId: '12' },
  { parentId: '13' },
  { parentId: '2' },
];
const proposal = (
  bookmarkId: string,
  fromParentId: string,
  toFolderId: string,
  selected = true
) => ({
  bookmarkId,
  fromParentId,
  toFolderId,
  selected,
});

it('shows the changed part of the tree as it will look after applying', () => {
  const tree = buildPreviewTree({
    folders,
    bookmarks,
    proposals: [
      proposal('a', '1', '12'),
      proposal('b', '13', 'new:tools'),
      proposal('c', '1', 'new:tools', false),
    ],
    newFolderTitles: { 'new:learning': 'Learning', 'new:tools': 'Tools' },
    barId: '1',
  });

  expect(tree).toHaveLength(1);
  const [bar] = tree;
  expect(bar).toMatchObject({ id: '1', title: 'Bar', isNew: false, keptCount: 1 });
  expect(bar.children.map((node) => [node.id, node.isNew])).toEqual([
    ['10', false],
    ['new:tools', true],
  ]);
  const archive = bar.children[0];
  expect(archive.children.map((node) => [node.title, node.keptCount])).toEqual([
    ['Job', 1],
    ['AI', 0],
  ]);
  expect(previewFolderCount(archive.children[0])).toBe(2);
  const tools = bar.children[1];
  expect(tools.incoming.map((item) => item.bookmarkId)).toEqual(['b', 'c']);
  expect(previewFolderCount(tools)).toBe(1);
});

it('leaves out folders that only lose unselected suggestions', () => {
  const tree = buildPreviewTree({
    folders,
    bookmarks,
    proposals: [proposal('x', '2', '12', false)],
    newFolderTitles: {},
    barId: '1',
  });
  expect(tree.map((node) => node.id)).toEqual(['1']);
});
