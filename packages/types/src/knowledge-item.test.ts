import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItemId,
  isKnowledgeItemV1,
  validateKnowledgeItemV1,
  type KnowledgeItemV1,
} from './index';

function createValidItem(): KnowledgeItemV1 {
  return {
    schemaVersion: 1,
    id: 'ki_v1_1234567890abcdef',
    title: 'Context engineering',
    url: 'https://example.com/context',
    source: 'chrome_bookmark',
    tags: ['ai'],
    topics: [],
    readState: 'UNREAD',
    createdAt: '2026-08-12T09:00:00.000Z',
    capturedAt: '2026-08-12T10:00:00.000Z',
    user: { tags: ['ai'] },
    ai: {
      provider: 'openai',
      model: 'gpt-test-mini',
      promptVersion: 'ai-summary-tags-v1',
      generatedAt: '2026-08-12T10:00:00.000Z',
    },
    metadata: { canonicalUrl: 'https://example.com/context' },
  };
}

describe('KnowledgeItem v1', () => {
  it('creates a stable opaque identity for the same source and canonical URL', () => {
    const input = {
      source: 'chrome_bookmark' as const,
      canonicalUrl: 'https://example.com/context',
    };

    expect(createKnowledgeItemId(input)).toBe('ki_v1_21c940c4f214f98b');
    expect(createKnowledgeItemId(input)).toBe(createKnowledgeItemId({ ...input }));
    expect(createKnowledgeItemId(input)).not.toContain('example.com');
  });

  it('keeps different capture sources as distinct identities', () => {
    const canonicalUrl = 'https://example.com/context';

    expect(
      createKnowledgeItemId({ source: 'chrome_bookmark', canonicalUrl })
    ).not.toBe(createKnowledgeItemId({ source: 'current_page', canonicalUrl }));
  });

  it('accepts a valid v1 object', () => {
    const item = createValidItem();

    expect(validateKnowledgeItemV1(item)).toEqual({ success: true, item });
    expect(isKnowledgeItemV1(item)).toBe(true);
  });

  it('reports invalid contract fields without throwing', () => {
    const invalid = {
      ...createValidItem(),
      source: 'not-a-source',
      tags: ['ai', 1],
      capturedAt: 'not-a-time',
      metadata: [],
      ai: { provider: 'unsupported-provider' },
    };

    const result = validateKnowledgeItemV1(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { field: 'source', code: 'invalid_source' },
          { field: 'tags', code: 'invalid_string_array' },
          { field: 'capturedAt', code: 'invalid_timestamp' },
          { field: 'metadata', code: 'invalid_metadata' },
          { field: 'ai', code: 'invalid_ai' },
        ])
      );
    }
    expect(isKnowledgeItemV1(invalid)).toBe(false);
  });
});
