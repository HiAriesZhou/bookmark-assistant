import { describe, expect, it } from 'vitest';
import { resolveAiTagCandidates, resolveAiTemplateProperties } from './notion';

describe('resolveAiTemplateProperties', () => {
  it('uses the fixed Bookmark Assistant template fields', () => {
    expect(resolveAiTemplateProperties({
      properties: {
        Description: { id: 'description-id', type: 'rich_text' },
        Tags: { id: 'tags-id', type: 'multi_select' },
      },
    })).toEqual({ descriptionPropertyId: 'description-id', tagsPropertyId: 'tags-id' });
  });

  it('rejects a renamed or incompatible template field', () => {
    expect(() => resolveAiTemplateProperties({
      properties: { Description: { id: 'description-id', type: 'rich_text' }, Tags: { id: 'tags-id', type: 'select' } },
    })).toThrow('ai_template_properties_unavailable');
  });

  it('reads existing tag option names from the configured multi-select property', () => {
    expect(resolveAiTagCandidates({ properties: {
      Other: { id: 'other-id', type: 'multi_select', multi_select: { options: [{ name: 'Ignore' }] } },
      Tags: { id: 'tags-id', type: 'multi_select', multi_select: { options: [{ name: 'AI' }, { name: 'Reading' }] } },
    } }, 'tags-id')).toEqual(['AI', 'Reading']);
  });
});
