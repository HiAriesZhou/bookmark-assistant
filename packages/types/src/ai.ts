/**
 * Shared AI contracts. These values intentionally describe product state only;
 * provider credentials, prompts, page bodies, and raw model responses never
 * belong in the shared data model.
 */
export const AI_PROVIDERS = [
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'groq',
  'minimax',
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_GENERATION_STATUSES = [
  'awaiting_confirmation',
  'queued',
  'processing',
  'succeeded',
  'skipped',
  'failed',
  'needs_action',
  'service_unavailable',
  'paused',
] as const;

export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];

export const AI_GENERATION_REASON_CODES = [
  'skipped_excluded_source',
  'skipped_fetch_disallowed',
  'skipped_insufficient_content',
  'skipped_unsupported_content_type',
  'skipped_user_modified',
  'skipped_target_unavailable',
  'failed_provider_request',
  'failed_invalid_output',
  'failed_notion_write',
  'needs_action_invalid_api_key',
  'needs_action_insufficient_quota',
  'needs_action_model_access',
  'needs_action_credential_deleted',
  'needs_action_notion_schema',
  'needs_action_notion_authorization',
  'service_provider_paused',
] as const;

export type AiGenerationReasonCode = (typeof AI_GENERATION_REASON_CODES)[number];

export type AiGenerationMode = 'single_page' | 'batch';

export type AiOutputLanguage = 'zh' | 'en';

export type AiModelOutput =
  | {
      status: 'ok';
      language: AiOutputLanguage;
      summary: string;
      tags: string[];
    }
  | {
      status: 'insufficient_content';
      language: AiOutputLanguage;
      summary: '';
      tags: [];
    };

export interface AiGenerationAggregate {
  awaitingConfirmation: number;
  queued: number;
  processing: number;
  succeeded: number;
  skipped: number;
  failed: number;
  needsAction: number;
  serviceUnavailable: number;
  paused: number;
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function isAiGenerationStatus(value: unknown): value is AiGenerationStatus {
  return typeof value === 'string' && (AI_GENERATION_STATUSES as readonly string[]).includes(value);
}
