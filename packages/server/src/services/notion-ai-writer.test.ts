import { describe, expect, it } from 'vitest';
import { createDescriptionBaselineHash, doesNotionPageMatchAiOutput, getDescriptionBaselineHash, prepareNotionAiWrite } from './notion-ai-writer';

const settings = { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' };
const emptyPage = {
  id: 'page-1',
  properties: {
    Description: { id: 'desc-id', type: 'rich_text', rich_text: [] },
    Tags: { id: 'tags-id', type: 'multi_select', multi_select: [{ name: 'Reading' }] },
  },
};
const output = { status: 'ok' as const, language: 'en' as const, summary: 'A clear summary.', tags: ['reading', 'AI'] };

describe('prepareNotionAiWrite', () => {
  it('captures the initial Description hash so generated metadata may be safely replaced', () => {
    const page = {
      ...emptyPage,
      properties: {
        ...emptyPage.properties,
        Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'Metadata description' }] },
      },
    };
    expect(getDescriptionBaselineHash(page, settings)).toBe(createDescriptionBaselineHash('Metadata description'));
  });

  it('prepares one atomic description and merged-tag update when description is empty', () => {
    expect(prepareNotionAiWrite(emptyPage, settings, output)).toEqual({
      action: 'write',
      descriptionBaselineHash: createDescriptionBaselineHash(''),
      properties: {
        'desc-id': { rich_text: [{ type: 'text', text: { content: 'A clear summary.' } }] },
        'tags-id': { multi_select: [{ name: 'Reading' }, { name: 'AI' }] },
      },
    });
  });

  it('preserves a user-edited description while still merging generated tags', () => {
    const page = {
      ...emptyPage,
      properties: {
        ...emptyPage.properties,
        Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'Synced base description' }] },
      },
    };
    expect(prepareNotionAiWrite(page, settings, output, createDescriptionBaselineHash('Synced base description'))).toMatchObject({ action: 'write' });
    expect(prepareNotionAiWrite(page, settings, output, createDescriptionBaselineHash('Different text'))).toEqual({
      action: 'write_tags_only',
      descriptionBaselineHash: createDescriptionBaselineHash('Synced base description'),
      properties: { 'tags-id': { multi_select: [{ name: 'Reading' }, { name: 'AI' }] } },
    });
  });

  it('fails safely if either required Notion property is absent or changes type', () => {
    expect(() => prepareNotionAiWrite(emptyPage, { ...settings, tagsPropertyId: 'missing' }, output)).toThrow(
      'target_unavailable'
    );
  });

  it('recognizes an AI result already present after an ambiguous update response', () => {
    const updated = {
      ...emptyPage,
      properties: {
        Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'A clear summary.' }] },
        Tags: { id: 'tags-id', type: 'multi_select', multi_select: [{ name: 'Reading' }, { name: 'AI' }] },
      },
    };
    expect(doesNotionPageMatchAiOutput(updated, settings, output)).toBe(true);
    expect(doesNotionPageMatchAiOutput(emptyPage, settings, output)).toBe(false);
  });
});
