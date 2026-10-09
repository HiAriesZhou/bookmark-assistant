import type { ReadState } from './types.js';
import { isAiProvider, type AiProvider } from './ai.js';

export const KNOWLEDGE_ITEM_SCHEMA_VERSION = 1 as const;

export type KnowledgeItemSource =
  | 'chrome_bookmark'
  | 'chrome_reading_list'
  | 'current_page'
  | 'context_menu'
  | 'legacy_unknown';

export interface KnowledgeItemUserFields {
  note?: string;
  tags?: string[];
}

export interface KnowledgeItemAiFields {
  summary?: string;
  tags?: string[];
  topics?: string[];
  provider?: AiProvider;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
}

export interface KnowledgeItemV1 {
  schemaVersion: typeof KNOWLEDGE_ITEM_SCHEMA_VERSION;
  id: string;
  title: string;
  url: string;
  source: KnowledgeItemSource;
  content?: string;
  excerpt?: string;
  summary?: string;
  tags: string[];
  topics: string[];
  readState?: ReadState;
  createdAt: string;
  capturedAt: string;
  updatedAt?: string;
  user: KnowledgeItemUserFields;
  ai: KnowledgeItemAiFields;
  metadata: Record<string, unknown>;
}

export interface KnowledgeItemIdInput {
  source: KnowledgeItemSource;
  canonicalUrl: string;
}

export type KnowledgeItemValidationIssueCode =
  | 'invalid_schema_version'
  | 'invalid_id'
  | 'invalid_title'
  | 'invalid_url'
  | 'invalid_source'
  | 'invalid_string_array'
  | 'invalid_read_state'
  | 'invalid_timestamp'
  | 'invalid_user'
  | 'invalid_ai'
  | 'invalid_metadata';

export interface KnowledgeItemValidationIssue {
  field: string;
  code: KnowledgeItemValidationIssueCode;
}

export type KnowledgeItemValidationResult =
  | { success: true; item: KnowledgeItemV1 }
  | { success: false; issues: KnowledgeItemValidationIssue[] };

const FNV_1A_64_OFFSET_BASIS = BigInt('0xcbf29ce484222325');
const FNV_1A_64_PRIME = BigInt('0x100000001b3');
const FNV_1A_64_MASK = BigInt('0xffffffffffffffff');
const KNOWLEDGE_ITEM_SOURCES = new Set<KnowledgeItemSource>([
  'chrome_bookmark',
  'chrome_reading_list',
  'current_page',
  'context_menu',
  'legacy_unknown',
]);

/**
 * Creates the stable, opaque v1 identity defined by Decision 0004.
 *
 * This is an identity key, not a cryptographic integrity mechanism. It intentionally
 * excludes legacy sync IDs because their stability differs by capture producer.
 */
export function createKnowledgeItemId({ source, canonicalUrl }: KnowledgeItemIdInput): string {
  const hashInput = `v1\u001f${source}\u001f${canonicalUrl}`;
  let hash = FNV_1A_64_OFFSET_BASIS;

  for (let index = 0; index < hashInput.length; index++) {
    hash ^= BigInt(hashInput.charCodeAt(index));
    hash = (hash * FNV_1A_64_PRIME) & FNV_1A_64_MASK;
  }

  return `ki_v1_${hash.toString(16).padStart(16, '0')}`;
}

export function validateKnowledgeItemV1(value: unknown): KnowledgeItemValidationResult {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ field: 'item', code: 'invalid_metadata' }],
    };
  }

  const issues: KnowledgeItemValidationIssue[] = [];
  const item = value as Partial<KnowledgeItemV1>;

  if (item.schemaVersion !== KNOWLEDGE_ITEM_SCHEMA_VERSION) {
    issues.push({ field: 'schemaVersion', code: 'invalid_schema_version' });
  }
  if (!isNonEmptyString(item.id)) {
    issues.push({ field: 'id', code: 'invalid_id' });
  }
  if (!isNonEmptyString(item.title)) {
    issues.push({ field: 'title', code: 'invalid_title' });
  }
  if (!isNonEmptyString(item.url)) {
    issues.push({ field: 'url', code: 'invalid_url' });
  }
  if (!isKnowledgeItemSource(item.source)) {
    issues.push({ field: 'source', code: 'invalid_source' });
  }
  if (!isStringArray(item.tags)) {
    issues.push({ field: 'tags', code: 'invalid_string_array' });
  }
  if (!isStringArray(item.topics)) {
    issues.push({ field: 'topics', code: 'invalid_string_array' });
  }
  if (item.readState !== undefined && item.readState !== 'READ' && item.readState !== 'UNREAD') {
    issues.push({ field: 'readState', code: 'invalid_read_state' });
  }
  if (!isIsoTimestamp(item.createdAt)) {
    issues.push({ field: 'createdAt', code: 'invalid_timestamp' });
  }
  if (!isIsoTimestamp(item.capturedAt)) {
    issues.push({ field: 'capturedAt', code: 'invalid_timestamp' });
  }
  if (item.updatedAt !== undefined && !isIsoTimestamp(item.updatedAt)) {
    issues.push({ field: 'updatedAt', code: 'invalid_timestamp' });
  }
  if (!isKnowledgeItemUserFields(item.user)) {
    issues.push({ field: 'user', code: 'invalid_user' });
  }
  if (!isKnowledgeItemAiFields(item.ai)) {
    issues.push({ field: 'ai', code: 'invalid_ai' });
  }
  if (!isRecord(item.metadata)) {
    issues.push({ field: 'metadata', code: 'invalid_metadata' });
  }

  return issues.length === 0
    ? { success: true, item: item as KnowledgeItemV1 }
    : { success: false, issues };
}

export function isKnowledgeItemV1(value: unknown): value is KnowledgeItemV1 {
  return validateKnowledgeItemV1(value).success;
}

function isKnowledgeItemSource(value: unknown): value is KnowledgeItemSource {
  return typeof value === 'string' && KNOWLEDGE_ITEM_SOURCES.has(value as KnowledgeItemSource);
}

function isKnowledgeItemUserFields(value: unknown): value is KnowledgeItemUserFields {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.note === undefined || typeof value.note === 'string') &&
    (value.tags === undefined || isStringArray(value.tags))
  );
}

function isKnowledgeItemAiFields(value: unknown): value is KnowledgeItemAiFields {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.summary === undefined || typeof value.summary === 'string') &&
    (value.tags === undefined || isStringArray(value.tags)) &&
    (value.topics === undefined || isStringArray(value.topics)) &&
    (value.provider === undefined || isAiProvider(value.provider)) &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.promptVersion === undefined || isNonEmptyString(value.promptVersion)) &&
    (value.generatedAt === undefined || isIsoTimestamp(value.generatedAt))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
