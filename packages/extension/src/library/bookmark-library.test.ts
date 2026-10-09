import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalBookmarkIndex,
  filterLocalBookmarks,
  sortLocalBookmarks,
  type LocalBookmark,
} from './bookmark-library';

describe('local bookmark index', () => {
  it('keeps folder descendants together in Chrome order, including identically named folders', () => {
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'Work',
            children: [
              {
                id: '2',
                parentId: '1',
                title: 'Notes',
                children: [{ id: '3', parentId: '2', title: 'Z' }],
              },
              {
                id: '4',
                parentId: '1',
                title: 'Notes',
                children: [{ id: '5', parentId: '4', title: 'A' }],
              },
            ],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[];
    expect(buildLocalBookmarkIndex(tree, {}).folders.map(({ id }) => id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });
  it('preserves duplicate bookmark nodes and their separate local metadata', () => {
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'Work',
            children: [{ id: 'a', parentId: '1', title: 'Example A', url: 'https://example.com' }],
          },
          {
            id: '2',
            parentId: '0',
            title: 'Read',
            children: [{ id: 'b', parentId: '2', title: 'Example B', url: 'https://example.com/' }],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[];

    const index = buildLocalBookmarkIndex(tree, {
      a: { description: 'Work copy', tags: ['Work'], updatedAt: '2026-09-07T00:00:00.000Z' },
      b: { description: 'Read copy', tags: ['Read'], updatedAt: '2026-09-07T00:00:00.000Z' },
    });

    expect(index.bookmarks).toHaveLength(2);
    expect(index.duplicateGroups).toHaveLength(1);
    expect(index.bookmarks.map((item) => item.metadata.description)).toEqual([
      'Work copy',
      'Read copy',
    ]);
    expect(filterLocalBookmarks(index.bookmarks, { kind: 'tag', tag: 'read' }, '')).toHaveLength(1);
    expect(filterLocalBookmarks(index.bookmarks, { kind: 'duplicates' }, '')).toHaveLength(2);
  });

  it('searches local descriptions and tags without a remote service', () => {
    vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
    const index = buildLocalBookmarkIndex(
      [{ id: 'a', title: 'A', url: 'https://example.com' }] as chrome.bookmarks.BookmarkTreeNode[],
      {
        a: {
          description: 'Cognitive flow reference',
          tags: ['Design'],
          updatedAt: '2026-09-07T00:00:00.000Z',
        },
      }
    );

    expect(filterLocalBookmarks(index.bookmarks, { kind: 'all' }, 'cognitive')).toHaveLength(1);
    expect(filterLocalBookmarks(index.bookmarks, { kind: 'all' }, 'design')).toHaveLength(1);
  });

  it('separates loose root-container bookmarks from nested folder bookmarks', () => {
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            parentId: '0',
            title: 'Bookmarks bar',
            children: [
              { id: 'loose', parentId: '1', title: 'Loose', url: 'https://loose.example' },
              {
                id: '2',
                parentId: '1',
                title: 'Research',
                children: [
                  { id: 'nested', parentId: '2', title: 'Nested', url: 'https://nested.example' },
                ],
              },
            ],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[];

    const index = buildLocalBookmarkIndex(tree, {});

    expect(filterLocalBookmarks(index.bookmarks, { kind: 'uncategorized' }, '')).toEqual([
      expect.objectContaining({ id: 'loose', isTopLevel: true }),
    ]);
    expect(filterLocalBookmarks(index.bookmarks, { kind: 'folder', folderId: '2' }, '')).toEqual([
      expect.objectContaining({ id: 'nested', isTopLevel: false }),
    ]);
  });

  it('sorts a filtered result without mutating the library order', () => {
    const bookmarks = [
      {
        id: 'b',
        title: 'Zulu',
        url: 'https://beta.example/path',
        dateAdded: 10,
      },
      {
        id: 'a',
        title: 'Alpha',
        url: 'https://alpha.example/path',
        dateAdded: 20,
      },
    ] as LocalBookmark[];

    expect(sortLocalBookmarks(bookmarks, 'title-asc').map((bookmark) => bookmark.id)).toEqual([
      'a',
      'b',
    ]);
    expect(sortLocalBookmarks(bookmarks, 'title-desc').map((bookmark) => bookmark.id)).toEqual([
      'b',
      'a',
    ]);
    expect(sortLocalBookmarks(bookmarks, 'date-desc').map((bookmark) => bookmark.id)).toEqual([
      'a',
      'b',
    ]);
    expect(sortLocalBookmarks(bookmarks, 'date-asc').map((bookmark) => bookmark.id)).toEqual([
      'b',
      'a',
    ]);
    expect(bookmarks.map((bookmark) => bookmark.id)).toEqual(['b', 'a']);
  });
});
