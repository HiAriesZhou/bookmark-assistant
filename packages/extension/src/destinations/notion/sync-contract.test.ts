import { describe, expect, it } from 'vitest';
import {
  buildBookmarkPropertiesFromNotionSchema,
  diffLinkItems,
  mergeRetryResults,
  selectRetryableSyncFailures,
} from './core';

const notionSchema = {
  Name: { type: 'title' },
  URL: { type: 'url' },
  Tags: { type: 'multi_select' },
  Description: { type: 'rich_text' },
  Folder: { type: 'rich_text' },
  'Date Added': { type: 'date' },
  'Sync ID': { type: 'rich_text' },
  Source: { type: 'single_select' },
  Type: { type: 'single_select' },
  Status: { type: 'status' },
} as const;

describe('Notion sync contract fixtures', () => {
  it('keeps the Chrome Bookmark Notion property snapshot stable', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(notionSchema, {
      title: 'Bookmark fixture',
      url: 'https://example.com/bookmark',
      description: 'Bookmark description',
      path: 'Bookmarks / Research',
      tags: ['research', 'ai'],
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'chrome-bookmark-42',
      type: 'bookmark',
      source: 'chrome_bookmark',
    });

    expect(properties).toEqual({
      Name: { title: [{ text: { content: 'Bookmark fixture' } }] },
      URL: { url: 'https://example.com/bookmark' },
      Tags: { multi_select: [{ name: 'research' }, { name: 'ai' }] },
      Description: { rich_text: [{ text: { content: 'Bookmark description' } }] },
      Folder: { rich_text: [{ text: { content: 'Bookmarks / Research' } }] },
      'Date Added': { date: { start: '2026-08-12T10:00:00.000Z' } },
      'Sync ID': { rich_text: [{ text: { content: 'chrome-bookmark-42' } }] },
      Source: { single_select: { name: 'Bookmark' } },
      Type: { single_select: { name: 'Bookmark' } },
    });
  });

  it('keeps the Reading List Notion property snapshot stable', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(notionSchema, {
      title: 'Reading List fixture',
      url: 'https://example.com/read-later',
      description: 'Reading List description',
      path: 'Reading List',
      tags: ['read-later'],
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'reading-list-42',
      type: 'reading_list',
      source: 'reading_list',
      readState: 'READ',
    });

    expect(properties).toEqual({
      Name: { title: [{ text: { content: 'Reading List fixture' } }] },
      URL: { url: 'https://example.com/read-later' },
      Tags: { multi_select: [{ name: 'read-later' }] },
      Description: { rich_text: [{ text: { content: 'Reading List description' } }] },
      Folder: { rich_text: [{ text: { content: 'Reading List' } }] },
      'Date Added': { date: { start: '2026-08-12T10:00:00.000Z' } },
      'Sync ID': { rich_text: [{ text: { content: 'reading-list-42' } }] },
      Source: { single_select: { name: 'ReadingList' } },
      Type: { single_select: { name: 'Reading List' } },
      Status: { status: { name: 'Done' } },
    });
  });

  it('keeps the Current Page Notion property snapshot stable', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(notionSchema, {
      title: 'Current Page fixture',
      url: 'https://example.com/current',
      description: '',
      path: 'Quick Saves',
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'quick-save-42',
      source: 'current_page',
    });

    expect(properties).toEqual({
      Name: { title: [{ text: { content: 'Current Page fixture' } }] },
      URL: { url: 'https://example.com/current' },
      Folder: { rich_text: [{ text: { content: 'Quick Saves' } }] },
      'Date Added': { date: { start: '2026-08-12T10:00:00.000Z' } },
      'Sync ID': { rich_text: [{ text: { content: 'quick-save-42' } }] },
      Source: { single_select: { name: 'Bookmark' } },
    });
  });

  it('keeps create, update, skip, and retry planning semantics stable', () => {
    const create = diffLinkItems(
      [{ title: 'New item', url: 'https://example.com/new', syncId: 'new-item' }],
      []
    );
    const update = diffLinkItems(
      [
        {
          title: 'Read item',
          url: 'https://example.com/read',
          syncId: 'read-item',
          type: 'reading_list',
          readState: 'READ',
        },
      ],
      [
        {
          pageId: 'page-1',
          url: 'https://example.com/read',
          syncId: 'read-item',
          type: 'reading_list',
          readState: 'UNREAD',
        },
      ]
    );
    const skip = diffLinkItems(
      [
        {
          title: 'Existing item',
          url: 'https://example.com/existing',
          syncId: 'existing-item',
          type: 'bookmark',
        },
      ],
      [
        {
          pageId: 'page-2',
          url: 'https://example.com/existing',
          syncId: 'existing-item',
          type: 'bookmark',
        },
      ]
    );
    const initialFailure = {
      success: false as const,
      bookmark: 'Retry item',
      error: 'fetch failed',
      syncId: 'retry-item',
      retryCount: 0,
    };
    const retry = mergeRetryResults(
      [initialFailure],
      [
        {
          success: true as const,
          bookmark: 'Retry item',
          action: 'created' as const,
          syncId: 'retry-item',
          retryCount: 1,
        },
      ]
    );

    expect(create).toMatchObject({ toCreate: [{ syncId: 'new-item' }], skippedExisting: 0 });
    expect(update).toMatchObject({
      toCreate: [],
      toUpdate: [{ pageId: 'page-1', item: { readState: 'READ' } }],
      skippedExisting: 1,
    });
    expect(skip).toMatchObject({ toCreate: [], toUpdate: [], skippedExisting: 1 });
    expect(selectRetryableSyncFailures([initialFailure])).toEqual([initialFailure]);
    expect(retry).toEqual([
      {
        success: true,
        bookmark: 'Retry item',
        action: 'created',
        syncId: 'retry-item',
        retryCount: 1,
      },
    ]);
  });
});
