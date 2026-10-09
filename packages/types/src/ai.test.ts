import { describe, expect, it } from 'vitest';
import {
  AI_GENERATION_STATUSES,
  AI_PROVIDERS,
  isAiGenerationStatus,
  isAiProvider,
} from './index';

describe('AI shared contracts', () => {
  it('exposes official and curated compatible providers', () => {
    expect(AI_PROVIDERS).toEqual(['openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'minimax']);
    expect(isAiProvider('openai')).toBe(true);
    expect(isAiProvider('deepseek')).toBe(true);
    expect(isAiProvider('minimax')).toBe(true);
    expect(isAiProvider('openrouter')).toBe(false);
  });

  it('validates the full task status vocabulary', () => {
    expect(AI_GENERATION_STATUSES).toContain('awaiting_confirmation');
    expect(AI_GENERATION_STATUSES).toContain('needs_action');
    expect(AI_GENERATION_STATUSES).toContain('service_unavailable');
    expect(isAiGenerationStatus('succeeded')).toBe(true);
    expect(isAiGenerationStatus('retrying_forever')).toBe(false);
  });
});
