import { describe, expect, it } from 'vitest';
import {
  AI_PAGE_CONTENT_LIMIT,
  AiGenerationOutputError,
  buildAiSummaryCompressionPrompt,
  buildAiGenerationPrompt,
  canonicalizeGeneratedTags,
  parseAiModelOutput,
  sanitizeUrlForModel,
  selectSufficientAiContent,
} from './ai-generation-prompt';

describe('AI generation prompt', () => {
  it('uses Chinese only when content reliably indicates Chinese and strips sensitive URL components', () => {
    const result = buildAiGenerationPrompt({
      title: '一篇关于人工智能的文章',
      url: 'https://user:password@example.com/path?token=secret#fragment',
      body: '这是可供总结的正文内容。'.repeat(20),
      currentTags: ['AI'],
      tagCandidates: ['Artificial Intelligence'],
    });

    expect(result.language).toBe('zh');
    expect(result.prompt).toContain('https://example.com/path');
    expect(result.prompt).not.toContain('password');
    expect(result.prompt).not.toContain('token=secret');
  });

  it('uses English for ambiguous content and limits body and candidate vocabulary', () => {
    const result = buildAiGenerationPrompt({
      title: 'Short title',
      url: 'https://example.com/',
      body: 'a'.repeat(AI_PAGE_CONTENT_LIMIT + 100),
      currentTags: [],
      tagCandidates: Array.from({ length: 120 }, (_, index) => `tag-${index}`),
    });

    expect(result.language).toBe('en');
    expect(result.prompt).toContain('tag-99');
    expect(result.prompt).not.toContain('tag-100');
    expect(result.prompt).toContain('a'.repeat(AI_PAGE_CONTENT_LIMIT));
  });

  it('accepts only a valid summary and one to five unique tags', () => {
    expect(parseAiModelOutput('```json\n{"summary":"A concise summary.","tags":["AI","ai","Tools"]}\n```', 'en')).toEqual({
      status: 'ok',
      language: 'en',
      summary: 'A concise summary.',
      tags: ['AI', 'Tools'],
    });
    expect(() => parseAiModelOutput('{"summary":"","tags":[]}', 'en')).toThrow('AI output is invalid.');
    expect(() => parseAiModelOutput('{"summary":"x","tags":["a","b","c","d","e","f"]}', 'en')).toThrow(
      'AI output is invalid.'
    );
  });

  it('marks an otherwise valid overlong summary as recoverable for one compression request', () => {
    let caught: unknown;
    try {
      parseAiModelOutput(JSON.stringify({ summary: 'word '.repeat(61), tags: ['AI'] }), 'en');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiGenerationOutputError);
    expect(caught).toMatchObject({ code: 'summary_too_long' });
    const prompt = buildAiSummaryCompressionPrompt((caught as AiGenerationOutputError).recoverableOutput!);
    expect(prompt).toContain('60 English words');
    expect(prompt).toContain('"tags":["AI"]');
  });

  it('sanitizes invalid URLs to an empty provider input', () => {
    expect(sanitizeUrlForModel('not a url')).toBe('');
  });

  it('accepts the exact insufficient-content model response', () => {
    expect(parseAiModelOutput('{"status":"insufficient_content","summary":"","tags":[]}', 'en')).toEqual({
      status: 'insufficient_content', language: 'en', summary: '', tags: [],
    });
  });

  it('rejects unsafe or overlong generated tags', () => {
    expect(() => parseAiModelOutput('{"summary":"Useful.","tags":["line\\nbreak"]}', 'en')).toThrow();
    expect(() => parseAiModelOutput(`{"summary":"Useful.","tags":["${'x'.repeat(51)}"]}`, 'en')).toThrow();
  });

  it('uses tiered body, description, and title content', () => {
    expect(selectSufficientAiContent('Sign in', 'Short metadata')).toBe('Short metadata');
    const description = 'A useful description with enough factual context to summarize this bookmark and identify its main topic correctly.';
    expect(selectSufficientAiContent('Sign in', description)).toBe(description);
    expect(selectSufficientAiContent('Sign in', undefined, 'Product documentation')).toBe('Product documentation');
    expect(selectSufficientAiContent('Sign in', undefined, 'DeepSeek')).toBe('DeepSeek');
    expect(selectSufficientAiContent('Sign in', undefined, 'Home')).toBeUndefined();
  });

  it('maps generated tags to existing Notion option casing', () => {
    expect(canonicalizeGeneratedTags(['artificial intelligence'], ['Artificial Intelligence'])).toEqual(['Artificial Intelligence']);
    expect(canonicalizeGeneratedTags(['AI, tools', 'AI tools'], [])).toEqual(['AI tools']);
  });
});
