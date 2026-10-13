import { describe, it, expect } from 'vitest';
import { diffBookmarks, diffLinkItems } from '../core';

describe('bookmark sync diff behavior', () => {
  it('should correctly identify duplicates by syncId', () => {
    const diff = diffBookmarks(
      [
        { title: 'Existing', url: 'https://changed.example.com', syncId: 'sync-1' },
        { title: 'New', url: 'https://new.example.com', syncId: 'sync-2' },
      ],
      ['https://existing.example.com'],
      ['sync-1']
    );

    expect(diff.toCreate).toEqual([
      { title: 'New', url: 'https://new.example.com', syncId: 'sync-2' },
    ]);
    expect(diff.skippedExisting).toBe(1);
    expect(diff.stats.matchedBySyncId).toBe(1);
    expect(diff.stats.matchedByUrl).toBe(0);
  });

  it('should correctly identify duplicates by URL', () => {
    const diff = diffBookmarks(
      [
        { title: 'Existing', url: 'https://existing.example.com' },
        { title: 'New', url: 'https://new.example.com' },
      ],
      ['https://existing.example.com'],
      []
    );

    expect(diff.toCreate).toEqual([{ title: 'New', url: 'https://new.example.com' }]);
    expect(diff.skippedExisting).toBe(1);
    expect(diff.stats.matchedBySyncId).toBe(0);
    expect(diff.stats.matchedByUrl).toBe(1);
  });

  it('should create reading list rows separately from bookmark rows with the same URL', () => {
    const diff = diffLinkItems(
      [
        {
          title: 'Read Later',
          url: 'https://example.com/shared',
          type: 'reading_list',
          readState: 'UNREAD',
        },
      ],
      [
        {
          pageId: 'bookmark-page',
          url: 'https://example.com/shared',
          type: 'bookmark',
        },
      ]
    );

    expect(diff.toCreate).toHaveLength(1);
    expect(diff.skippedExisting).toBe(0);
  });

  it('should plan a Notion update when reading list read state changes', () => {
    const diff = diffLinkItems(
      [
        {
          title: 'Article',
          url: 'https://example.com/article',
          type: 'reading_list',
          readState: 'READ',
          syncId: 'reading-list-article',
        },
      ],
      [
        {
          pageId: 'page-1',
          url: 'https://example.com/article',
          type: 'reading_list',
          readState: 'UNREAD',
          syncId: 'reading-list-article',
        },
      ]
    );

    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([
      {
        pageId: 'page-1',
        item: {
          title: 'Article',
          url: 'https://example.com/article',
          type: 'reading_list',
          readState: 'READ',
          syncId: 'reading-list-article',
        },
      },
    ]);
    expect(diff.stats.updatesNeeded).toBe(1);
  });

  it('should plan a Notion update when an existing reading list row is missing source type', () => {
    const diff = diffLinkItems(
      [
        {
          title: 'Article',
          url: 'https://example.com/article',
          type: 'reading_list',
          readState: 'UNREAD',
          syncId: 'reading-list-article',
        },
      ],
      [
        {
          pageId: 'page-1',
          url: 'https://example.com/article',
          readState: 'UNREAD',
          syncId: 'reading-list-article',
        },
      ]
    );

    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([
      {
        pageId: 'page-1',
        item: {
          title: 'Article',
          url: 'https://example.com/article',
          type: 'reading_list',
          readState: 'UNREAD',
          syncId: 'reading-list-article',
        },
      },
    ]);
    expect(diff.stats.updatesNeeded).toBe(1);
  });

  it('should plan a Notion update when an existing bookmark row is missing source type', () => {
    const diff = diffLinkItems(
      [
        {
          title: 'Bookmark',
          url: 'https://example.com/bookmark',
          type: 'bookmark',
          syncId: 'bookmark-article',
        },
      ],
      [
        {
          pageId: 'page-1',
          url: 'https://example.com/bookmark',
          syncId: 'bookmark-article',
        },
      ]
    );

    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([
      {
        pageId: 'page-1',
        item: {
          title: 'Bookmark',
          url: 'https://example.com/bookmark',
          type: 'bookmark',
          syncId: 'bookmark-article',
        },
      },
    ]);
    expect(diff.stats.updatesNeeded).toBe(1);
  });
});
