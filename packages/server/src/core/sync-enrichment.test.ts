import { describe, expect, it } from 'vitest';
import { belongsToSyncTarget, readRichTextProperty } from './sync-enrichment';

describe('sync enrichment guards', () => {
  it('reads encoded Notion rich-text property IDs', () => {
    expect(
      readRichTextProperty(
        {
          properties: {
            Description: {
              id: 'abc%3Adef',
              type: 'rich_text',
              rich_text: [{ plain_text: 'User description' }],
            },
          },
        },
        'abc:def'
      )
    ).toBe('User description');
  });

  it('only accepts pages in the active data source or its legacy database parent', () => {
    expect(
      belongsToSyncTarget({ parent: { data_source_id: 'source-1' } }, 'source-1', 'db-1')
    ).toBe(true);
    expect(belongsToSyncTarget({ parent: { database_id: 'db-1' } }, 'source-1', 'db-1')).toBe(true);
    expect(belongsToSyncTarget({ parent: { data_source_id: 'other' } }, 'source-1', 'db-1')).toBe(
      false
    );
    expect(belongsToSyncTarget({ parent: { page_id: 'page-1' } }, 'source-1', 'db-1')).toBe(false);
    expect(
      belongsToSyncTarget({ archived: true, parent: { data_source_id: 'source-1' } }, 'source-1')
    ).toBe(false);
  });
});
