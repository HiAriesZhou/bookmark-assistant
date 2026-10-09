import { describe, expect, it } from 'vitest';
import type { BookmarkTreeNodeLike } from '../core';
import { analyzeBookmarkLibrary } from './library-health';

function sampleTree(): BookmarkTreeNodeLike[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          title: 'Bookmarks Bar',
          children: [
            {
              id: 'top-level',
              parentId: 'bar',
              title: 'Top level',
              url: 'https://example.com/top',
            },
            {
              id: 'design',
              parentId: 'bar',
              title: 'Design',
              children: [
                {
                  id: 'duplicate-a',
                  parentId: 'design',
                  title: 'Duplicate A',
                  url: 'https://example.com/article/?b=2&a=1#intro',
                },
                {
                  id: 'nested',
                  parentId: 'design',
                  title: 'Nested',
                  children: [
                    {
                      id: 'duplicate-b',
                      parentId: 'nested',
                      title: 'Duplicate B',
                      url: 'https://example.com/article?a=1&b=2',
                    },
                  ],
                },
              ],
            },
          ],
        },
        { id: 'other', parentId: 'root', title: 'Other Bookmarks', children: [] },
      ],
    },
  ];
}

describe('analyzeBookmarkLibrary', () => {
  it('uses strict folder, duplicate, uncategorized, and sync-estimate semantics', () => {
    const health = analyzeBookmarkLibrary(sampleTree(), [
      { url: 'https://example.com/top' },
      { url: 'https://reading.example/article' },
    ]);

    expect(health).toEqual({
      version: 1,
      bookmarkCount: 3,
      userFolderCount: 2,
      readingListCount: 2,
      duplicateGroupCount: 1,
      duplicateExtraItemCount: 1,
      topLevelUncategorizedCount: 1,
      largestFolderItemCount: 2,
      estimatedLocalSyncItems: 4,
    });
  });

  it('keeps invalid URLs stable without throwing', () => {
    const tree = sampleTree();
    tree[0].children?.[0].children?.push(
      { id: 'invalid-a', parentId: 'bar', title: 'Invalid A', url: 'not a url' },
      { id: 'invalid-b', parentId: 'bar', title: 'Invalid B', url: 'not a url' }
    );
    const health = analyzeBookmarkLibrary(tree);
    expect(health.duplicateGroupCount).toBe(2);
    expect(health.duplicateExtraItemCount).toBe(2);
  });

  it('handles a deeply nested tree iteratively', () => {
    const leaf: BookmarkTreeNodeLike = {
      id: 'leaf',
      parentId: 'folder-4999',
      title: 'Leaf',
      url: 'https://example.com/deep',
    };
    let child = leaf;
    for (let index = 4_999; index >= 0; index -= 1) {
      child = {
        id: `folder-${index}`,
        parentId: index === 0 ? 'bar' : `folder-${index - 1}`,
        title: `Folder ${index}`,
        children: [child],
      };
    }
    const tree: BookmarkTreeNodeLike[] = [
      {
        id: 'root',
        title: '',
        children: [{ id: 'bar', parentId: 'root', title: 'Bookmarks Bar', children: [child] }],
      },
    ];
    const health = analyzeBookmarkLibrary(tree);
    expect(health.userFolderCount).toBe(5_000);
    expect(health.largestFolderItemCount).toBe(1);
  });

  it('handles a 20,000 bookmark synthetic library', () => {
    const children: BookmarkTreeNodeLike[] = Array.from({ length: 20_000 }, (_, index) => ({
      id: `bookmark-${index}`,
      parentId: 'bulk',
      title: `Synthetic ${index}`,
      url: `https://example.com/${index}`,
    }));
    const tree: BookmarkTreeNodeLike[] = [
      {
        id: 'root',
        title: '',
        children: [
          {
            id: 'bar',
            parentId: 'root',
            title: 'Bookmarks Bar',
            children: [{ id: 'bulk', parentId: 'bar', title: 'Bulk', children }],
          },
        ],
      },
    ];
    const health = analyzeBookmarkLibrary(tree);
    expect(health.bookmarkCount).toBe(20_000);
    expect(health.largestFolderItemCount).toBe(20_000);
    expect(health.duplicateGroupCount).toBe(0);
  });
});
