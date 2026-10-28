/**
 * TDD Tests for Notion Property Mapping - Type and ReadState fields
 * @vitest-environment node
 *
 * RED Phase: Write tests that define expected behavior
 * GREEN Phase: Implementation already exists, tests should pass
 */

import { describe, it, expect } from 'vitest';
import {
  buildBookmarkPropertiesFromNotionSchema,
  extractNotionPageLinkKeys,
  isReadOnlyNotionPropertyType,
} from './index';
import type { LinkItem as BookmarkItem } from '@bookmark-assistant/types';

describe('BookmarkItem type definition', () => {
  describe('type field', () => {
    it('should accept type=bookmark', () => {
      const bookmark: BookmarkItem = {
        title: 'Test Bookmark',
        url: 'https://example.com',
        type: 'bookmark',
      };
      expect(bookmark.type).toBe('bookmark');
    });

    it('should accept type=reading_list', () => {
      const readingList: BookmarkItem = {
        title: 'Test Reading List Item',
        url: 'https://example.com/article',
        type: 'reading_list',
      };
      expect(readingList.type).toBe('reading_list');
    });

    it('should allow type to be undefined for backward compatibility', () => {
      const legacyItem: BookmarkItem = {
        title: 'Legacy Bookmark',
        url: 'https://example.com/legacy',
        // type is intentionally omitted
      };
      expect(legacyItem.type).toBeUndefined();
    });
  });

  describe('readState field', () => {
    it('should accept readState=UNREAD', () => {
      const item: BookmarkItem = {
        title: 'Unread Article',
        url: 'https://example.com/unread',
        readState: 'UNREAD',
      };
      expect(item.readState).toBe('UNREAD');
    });

    it('should accept readState=READ', () => {
      const item: BookmarkItem = {
        title: 'Read Article',
        url: 'https://example.com/read',
        readState: 'READ',
      };
      expect(item.readState).toBe('READ');
    });

    it('should allow readState to be undefined for bookmarks', () => {
      const bookmark: BookmarkItem = {
        title: 'Regular Bookmark',
        url: 'https://example.com',
        // readState not applicable for bookmarks
      };
      expect(bookmark.readState).toBeUndefined();
    });
  });

  describe('combined reading list item', () => {
    it('should accept full reading list item with type and readState', () => {
      const item: BookmarkItem = {
        title: 'Complete Reading List Item',
        url: 'https://example.com/article',
        type: 'reading_list',
        readState: 'UNREAD',
        dateAdded: '2024-01-15T10:00:00.000Z',
        syncId: 'test-uuid-123',
      };

      expect(item.title).toBe('Complete Reading List Item');
      expect(item.url).toBe('https://example.com/article');
      expect(item.type).toBe('reading_list');
      expect(item.readState).toBe('UNREAD');
      expect(item.dateAdded).toBe('2024-01-15T10:00:00.000Z');
      expect(item.syncId).toBe('test-uuid-123');
    });

    it('should support both read and unread states', () => {
      const unreadItem: BookmarkItem = {
        title: 'Article',
        url: 'https://example.com/1',
        type: 'reading_list',
        readState: 'UNREAD',
      };

      const readItem: BookmarkItem = {
        title: 'Article',
        url: 'https://example.com/2',
        type: 'reading_list',
        readState: 'READ',
      };

      expect(unreadItem.readState).toBe('UNREAD');
      expect(readItem.readState).toBe('READ');
      expect(unreadItem.readState).not.toBe(readItem.readState);
    });
  });

  describe('backward compatibility', () => {
    it('should support legacy bookmark without type field', () => {
      const legacy: BookmarkItem = {
        title: 'Legacy Bookmark',
        url: 'https://example.com',
        path: 'Bookmarks / Folder',
        description: 'A description',
        tags: ['tag1', 'tag2'],
        dateAdded: '2024-01-01T00:00:00.000Z',
        syncId: 'legacy-id',
      };

      expect(legacy.type).toBeUndefined();
      expect(legacy.title).toBe('Legacy Bookmark');
      expect(legacy.path).toBe('Bookmarks / Folder');
    });

    it('should support new reading list item with all fields', () => {
      const newItem: BookmarkItem = {
        title: 'New Reading List Item',
        url: 'https://example.com/new',
        type: 'reading_list',
        readState: 'UNREAD',
        dateAdded: '2024-01-15T10:00:00.000Z',
        syncId: 'new-uuid',
        // path is intentionally omitted for reading list
      };

      expect(newItem.type).toBe('reading_list');
      expect(newItem.path).toBeUndefined(); // Reading list has no folder path
    });
  });
});

describe('PROPERTY_MAPPING_CONFIG behavior', () => {
  it('should build Notion properties using the public server-core mapper', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Name: { type: 'title' },
        URL: { type: 'url' },
        Tags: { type: 'multi_select' },
        Description: { type: 'rich_text' },
        Folder: { type: 'rich_text' },
        'Date Added': { type: 'date' },
        'Sync ID': { type: 'rich_text' },
        Source: { type: 'single_select' },
        Status: { type: 'single_select' },
      },
      {
        title: 'Reading List Article',
        url: 'https://example.com/article',
        description: 'Article summary',
        path: 'Reading List',
        tags: ['reading', 'core'],
        dateAdded: '2026-01-02T00:00:00.000Z',
        syncId: 'reading-list-article',
        type: 'reading_list',
        readState: 'READ',
      }
    );

    expect((properties.Name as any).title[0].text.content).toBe('Reading List Article');
    expect((properties.URL as any).url).toBe('https://example.com/article');
    expect((properties.Tags as any).multi_select).toEqual([{ name: 'reading' }, { name: 'core' }]);
    expect((properties.Description as any).rich_text[0].text.content).toBe('Article summary');
    expect((properties.Folder as any).rich_text[0].text.content).toBe('Reading List');
    expect((properties['Date Added'] as any).date.start).toBe('2026-01-02T00:00:00.000Z');
    expect((properties['Sync ID'] as any).rich_text[0].text.content).toBe('reading-list-article');
    expect((properties.Source as any).single_select.name).toBe('ReadingList');
    expect((properties.Status as any).single_select.name).toBe('Done');
  });

  it('should map bookmark and unread states to Notion select/status values', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Source: { type: 'single_select' },
        Status: { type: 'single_select' },
      },
      {
        title: 'Bookmark',
        url: 'https://example.com/bookmark',
        type: 'bookmark',
        readState: 'UNREAD',
      }
    );

    expect((properties.Source as any).single_select.name).toBe('Bookmark');
    expect((properties.Status as any).single_select.name).toBe('Unread');
  });

  it('should write real Notion select properties for Source and Status', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Source: { type: 'select' },
        Status: { type: 'select' },
      },
      {
        title: 'Reading List Article',
        url: 'https://example.com/article',
        type: 'reading_list',
        readState: 'READ',
      }
    );

    expect((properties.Source as any).select.name).toBe('ReadingList');
    expect((properties.Status as any).select.name).toBe('Done');
    expect(properties.Source).not.toHaveProperty('single_select');
    expect(properties.Status).not.toHaveProperty('single_select');
  });

  it('should map saved page sources to the Bookmark Source option', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Source: { type: 'single_select' },
      },
      {
        title: 'Current Page',
        url: 'https://example.com/current-page',
        source: 'current_page',
      }
    );

    expect((properties.Source as any).single_select.name).toBe('Bookmark');
  });

  it('should keep legacy Type and Notion status properties compatible', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Type: { type: 'single_select' },
        Status: { type: 'status' },
      },
      {
        title: 'Legacy Reading List Article',
        url: 'https://example.com/legacy-article',
        type: 'reading_list',
        readState: 'READ',
      }
    );

    expect((properties.Type as any).single_select.name).toBe('Reading List');
    expect((properties.Status as any).status.name).toBe('Done');
  });

  it('should skip read-only Notion property types', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        Name: { type: 'title' },
        Formula: { type: 'formula' },
        Edited: { type: 'last_edited_time' },
      },
      {
        title: 'Read-only Skip',
        url: 'https://example.com/read-only-skip',
      }
    );

    expect(isReadOnlyNotionPropertyType('formula')).toBe(true);
    expect(isReadOnlyNotionPropertyType('last_edited_time')).toBe(true);
    expect(isReadOnlyNotionPropertyType('title')).toBe(false);
    expect(properties).toHaveProperty('Name');
    expect(properties).not.toHaveProperty('Formula');
    expect(properties).not.toHaveProperty('Edited');
  });

  it('should use fallback title property names from Pro runtime resolution', () => {
    const properties = buildBookmarkPropertiesFromNotionSchema(
      {
        URL: { type: 'url' },
      },
      {
        title: '',
        url: 'https://example.com/fallback-title',
      },
      {
        fallbackTitlePropertyName: 'Resolved Title',
      }
    );

    expect((properties['Resolved Title'] as any).title[0].text.content).toBe('Untitled Bookmark');
  });

  it('should extract type and read state from existing Notion pages', () => {
    const keys = extractNotionPageLinkKeys({
      properties: {
        URL: { type: 'url', url: 'https://example.com/article' },
        'Sync ID': {
          type: 'rich_text',
          rich_text: [{ plain_text: 'reading-list-article' }],
        },
        Source: { type: 'single_select', single_select: { name: 'ReadingList' } },
        Status: { type: 'single_select', single_select: { name: 'Done' } },
      },
    });

    expect(keys).toEqual({
      url: 'https://example.com/article',
      syncId: 'reading-list-article',
      type: 'reading_list',
      readState: 'READ',
    });
  });

  it('should extract type and read state from real Notion select properties', () => {
    const keys = extractNotionPageLinkKeys({
      properties: {
        URL: { type: 'url', url: 'https://example.com/article' },
        Source: { type: 'select', select: { name: 'ReadingList' } },
        Status: { type: 'select', select: { name: 'Done' } },
      },
    });

    expect(keys).toEqual({
      url: 'https://example.com/article',
      syncId: undefined,
      type: 'reading_list',
      readState: 'READ',
    });
  });

  it('should extract in-progress Status values as unread until Chrome exposes a third state', () => {
    const keys = extractNotionPageLinkKeys({
      properties: {
        URL: { type: 'url', url: 'https://example.com/reading' },
        Source: { type: 'single_select', single_select: { name: 'ReadingList' } },
        Status: { type: 'single_select', single_select: { name: 'Reading' } },
      },
    });

    expect(keys.type).toBe('reading_list');
    expect(keys.readState).toBe('UNREAD');
  });
});
