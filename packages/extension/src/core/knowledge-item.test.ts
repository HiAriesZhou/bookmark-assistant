import { describe, expect, it } from 'vitest';
import type { LinkItem } from '@bookmark-assistant/types';
import {
  createDefaultKnowledgeItemId,
  getKnowledgeItemValidationIssues,
  knowledgeItemToLegacyLinkItem,
  linkItemToKnowledgeItem,
  prepareLegacyLinkItemForSync,
} from './knowledge-item';

const capturedAt = new Date('2026-08-12T10:00:00.000Z');

function mapLinkItem(item: LinkItem) {
  return linkItemToKnowledgeItem(item, {
    now: () => capturedAt,
    createId: createDefaultKnowledgeItemId,
    normalizeUrl: (url) => url.replace('https://www.', 'https://'),
  });
}

describe('KnowledgeItem mapper', () => {
  it('maps a Chrome bookmark without mutating the legacy item', () => {
    const legacy: LinkItem = {
      title: 'Context engineering',
      url: 'https://www.example.com/context',
      path: 'Research / AI',
      description: 'A saved article',
      tags: ['ai', 'context'],
      dateAdded: '2026-08-10T08:00:00.000Z',
      syncId: 'chrome-bookmark-42',
      type: 'bookmark',
      source: 'chrome_bookmark',
    };
    const original = structuredClone(legacy);

    const item = mapLinkItem(legacy);

    expect(item).toMatchObject({
      schemaVersion: 1,
      title: legacy.title,
      url: legacy.url,
      source: 'chrome_bookmark',
      excerpt: legacy.description,
      tags: legacy.tags,
      topics: [],
      createdAt: legacy.dateAdded,
      capturedAt: capturedAt.toISOString(),
      user: { tags: legacy.tags },
      ai: {},
      metadata: {
        canonicalUrl: 'https://example.com/context',
        originalUrl: legacy.url,
        sourceId: legacy.syncId,
        bookmarkPath: legacy.path,
        legacyType: 'bookmark',
      },
    });
    expect(item.id).toBe(
      createDefaultKnowledgeItemId({
        source: 'chrome_bookmark',
        canonicalUrl: 'https://example.com/context',
      })
    );
    expect(legacy).toEqual(original);
    expect(getKnowledgeItemValidationIssues(item)).toEqual([]);

    expect(knowledgeItemToLegacyLinkItem(item)).toEqual({
      success: true,
      item: legacy,
      losses: [],
    });
  });

  it('maps the existing Reading List source to the canonical Chrome source', () => {
    const legacy: LinkItem = {
      title: 'Read later',
      url: 'https://example.com/read-later',
      path: 'Reading List',
      description: '',
      dateAdded: '2026-08-11T08:00:00.000Z',
      syncId: 'reading-list-article',
      type: 'reading_list',
      source: 'reading_list',
      readState: 'UNREAD',
    };

    const item = mapLinkItem(legacy);

    expect(item.source).toBe('chrome_reading_list');
    expect(item.readState).toBe('UNREAD');
    expect(knowledgeItemToLegacyLinkItem(item)).toEqual({
      success: true,
      item: legacy,
      losses: [],
    });
    expect(
      prepareLegacyLinkItemForSync(legacy, {
        now: () => capturedAt,
        createId: createDefaultKnowledgeItemId,
        normalizeUrl: (url) => url,
      })
    ).toEqual({ success: true, item: legacy });
  });

  it('uses legacy_unknown only when legacy input has no source', () => {
    const item = mapLinkItem({
      title: 'Legacy',
      url: 'https://example.com/legacy',
      dateAdded: '2026-08-11T08:00:00.000Z',
    });

    expect(item.source).toBe('legacy_unknown');
    expect(knowledgeItemToLegacyLinkItem(item)).toEqual({
      success: false,
      losses: [{ field: 'source', code: 'unsupported_source' }],
    });
  });

  it('round-trips a Current Page capture before the legacy server sync', () => {
    const legacy: LinkItem = {
      title: 'Current page',
      url: 'https://example.com/current?utm_source=bookmark-assistant',
      description: '',
      path: 'Quick Saves',
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'quick-save-1',
      source: 'current_page',
    };

    const item = mapLinkItem(legacy);

    expect(item.source).toBe('current_page');
    expect(getKnowledgeItemValidationIssues(item)).toEqual([]);
    expect(knowledgeItemToLegacyLinkItem(item)).toEqual({
      success: true,
      item: legacy,
      losses: [],
    });
  });

  it('maps a Context Menu capture without inferring a different source', () => {
    const legacy: LinkItem = {
      title: 'Selected link',
      url: 'https://example.com/link',
      description: '',
      path: 'Quick Saves',
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'context-menu-1',
      source: 'context_menu',
    };

    const item = mapLinkItem(legacy);

    expect(item.source).toBe('context_menu');
    expect(knowledgeItemToLegacyLinkItem(item)).toEqual({
      success: true,
      item: legacy,
      losses: [],
    });
  });

  it('prepares a Chrome bookmark for the legacy sync payload through KnowledgeItem', () => {
    const legacy: LinkItem = {
      title: 'Bulk bookmark',
      url: 'https://example.com/bulk',
      description: '',
      path: 'Bookmarks / Research',
      dateAdded: '2026-08-12T10:00:00.000Z',
      syncId: 'chrome-bookmark-99',
      type: 'bookmark',
      source: 'chrome_bookmark',
    };

    expect(
      prepareLegacyLinkItemForSync(legacy, {
        now: () => capturedAt,
        createId: createDefaultKnowledgeItemId,
        normalizeUrl: (url) => url,
      })
    ).toEqual({ success: true, item: legacy });
  });

  it('reports fields that the legacy payload cannot represent', () => {
    const item = mapLinkItem({
      title: 'Future knowledge',
      url: 'https://example.com/future',
      source: 'current_page',
      dateAdded: '2026-08-11T08:00:00.000Z',
    });
    item.content = 'Captured content';
    item.ai = { summary: 'Generated summary' };
    item.metadata.futureField = 'not supported by LinkItem';

    const result = knowledgeItemToLegacyLinkItem(item);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.losses).toEqual(
        expect.arrayContaining([
          { field: 'content', code: 'unsupported_field' },
          { field: 'ai', code: 'unsupported_field' },
          { field: 'metadata.futureField', code: 'unsupported_metadata' },
        ])
      );
    }
  });
});
