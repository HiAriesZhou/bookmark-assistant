import type { AiCredentialSummary } from '../../background/server-api';

export type AiSettingsProvider = AiCredentialSummary['provider'];

// Provider names are brands and stay untranslated.
export const AI_PROVIDER_LABELS: Readonly<Record<AiSettingsProvider, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  minimax: 'MiniMax',
};

/** Builds the "Provider · host" line shown under the detected model. */
export function aiCredentialIdentityLine(credential: AiCredentialSummary): string {
  return [AI_PROVIDER_LABELS[credential.provider], credential.host].filter(Boolean).join(' · ');
}
