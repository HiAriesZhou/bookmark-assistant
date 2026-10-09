import type { AiProvider } from '@bookmark-assistant/types';

const AI_PROVIDERS: readonly AiProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'groq',
  'minimax',
];

/** Runtime guard kept in the CommonJS server bundle. */
export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && AI_PROVIDERS.includes(value as AiProvider);
}
