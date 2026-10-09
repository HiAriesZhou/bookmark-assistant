export type AiSettingsProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'groq'
  | 'minimax';

export function providerChangeRequiresNewKey(
  savedProvider: AiSettingsProvider | undefined,
  selectedProvider: AiSettingsProvider,
  apiKey: string
): boolean {
  return !!savedProvider && savedProvider !== selectedProvider && !apiKey.trim();
}
