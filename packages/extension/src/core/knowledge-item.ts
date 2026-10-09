import {
  createKnowledgeItemId,
  validateKnowledgeItemV1,
  type KnowledgeItemIdInput,
  type KnowledgeItemSource,
  type KnowledgeItemV1,
  type KnowledgeItemValidationIssue,
} from '@bookmark-assistant/types';
import type { LinkCaptureSource, LinkItem } from '@bookmark-assistant/types';

export interface LinkItemToKnowledgeItemOptions {
  now: () => Date;
  createId: (input: KnowledgeItemIdInput) => string;
  normalizeUrl: (url: string) => string;
  sourceFallback?: KnowledgeItemSource;
}

export type LegacyMappingLossCode =
  | 'unsupported_source'
  | 'unsupported_field'
  | 'conflicting_user_tags'
  | 'unsupported_metadata';

export interface LegacyMappingLoss {
  field: string;
  code: LegacyMappingLossCode;
}

export type LegacyLinkItemMappingResult =
  | { success: true; item: LinkItem; losses: [] }
  | { success: false; losses: LegacyMappingLoss[] };

export type PreparedLegacyLinkItemResult =
  | { success: true; item: LinkItem }
  | { success: false; reason: 'invalid_knowledge_item' | 'lossy_legacy_mapping' };

const LEGACY_METADATA_KEYS = new Set([
  'canonicalUrl',
  'originalUrl',
  'sourceId',
  'bookmarkPath',
  'legacyDescriptionPresent',
  'legacyTagsPresent',
  'legacyDateAddedPresent',
  'legacyType',
  'legacySource',
]);

/**
 * Maps the existing browser/sync object into the canonical capture contract.
 * No clocks, random values, or URL normalizers are hidden in this function.
 */
export function linkItemToKnowledgeItem(
  item: LinkItem,
  options: LinkItemToKnowledgeItemOptions
): KnowledgeItemV1 {
  const capturedAt = options.now().toISOString();
  const source = toKnowledgeItemSource(item.source, options.sourceFallback);
  const canonicalUrl = options.normalizeUrl(item.url);
  const metadata: Record<string, unknown> = {
    canonicalUrl,
    legacyDescriptionPresent: item.description !== undefined,
    legacyTagsPresent: item.tags !== undefined,
    legacyDateAddedPresent: item.dateAdded !== undefined,
  };

  if (canonicalUrl !== item.url) {
    metadata.originalUrl = item.url;
  }
  if (item.syncId !== undefined) {
    metadata.sourceId = item.syncId;
  }
  if (item.path !== undefined) {
    metadata.bookmarkPath = item.path;
  }
  if (item.type !== undefined) {
    metadata.legacyType = item.type;
  }
  if (item.source === 'import') {
    metadata.legacySource = 'import';
  }

  const tags = item.tags ? [...item.tags] : [];
  const knowledgeItem: KnowledgeItemV1 = {
    schemaVersion: 1,
    id: options.createId({ source, canonicalUrl }),
    title: item.title,
    url: item.url,
    source,
    tags,
    topics: [],
    createdAt: normalizeDateAdded(item.dateAdded, capturedAt),
    capturedAt,
    user: item.tags ? { tags: [...item.tags] } : {},
    ai: {},
    metadata,
  };

  if (item.description !== undefined) {
    knowledgeItem.excerpt = item.description;
  }
  if (item.readState !== undefined) {
    knowledgeItem.readState = item.readState;
  }

  return knowledgeItem;
}

/**
 * Maps the v1 contract back to the current sync payload. Unsupported values are
 * reported instead of being silently dropped, so callers can keep the legacy path.
 */
export function knowledgeItemToLegacyLinkItem(item: KnowledgeItemV1): LegacyLinkItemMappingResult {
  const losses = collectLegacyMappingLosses(item);
  const source = toLegacyCaptureSource(item.source);

  if (!source) {
    losses.push({ field: 'source', code: 'unsupported_source' });
  }

  if (losses.length > 0 || !source) {
    return { success: false, losses };
  }

  const metadata = item.metadata;
  const legacy: LinkItem = {
    title: item.title,
    url: item.url,
    source,
  };

  if (metadata.legacyDescriptionPresent === true || item.excerpt !== undefined) {
    legacy.description = item.excerpt ?? '';
  }
  if (metadata.legacyTagsPresent === true || item.tags.length > 0) {
    legacy.tags = [...item.tags];
  }
  if (metadata.legacyDateAddedPresent === true) {
    legacy.dateAdded = item.createdAt;
  }
  if (typeof metadata.sourceId === 'string') {
    legacy.syncId = metadata.sourceId;
  }
  if (typeof metadata.bookmarkPath === 'string') {
    legacy.path = metadata.bookmarkPath;
  }
  if (metadata.legacyType === 'bookmark' || metadata.legacyType === 'reading_list') {
    legacy.type = metadata.legacyType;
  }
  if (item.readState !== undefined) {
    legacy.readState = item.readState;
  }

  return { success: true, item: legacy, losses: [] };
}

/**
 * Runs a capture through the canonical contract before returning the current
 * server payload. Failure reasons deliberately exclude captured content.
 */
export function prepareLegacyLinkItemForSync(
  item: LinkItem,
  options: LinkItemToKnowledgeItemOptions
): PreparedLegacyLinkItemResult {
  const knowledgeItem = linkItemToKnowledgeItem(item, options);
  if (getKnowledgeItemValidationIssues(knowledgeItem).length > 0) {
    return { success: false, reason: 'invalid_knowledge_item' };
  }

  const legacyMapping = knowledgeItemToLegacyLinkItem(knowledgeItem);
  return legacyMapping.success
    ? { success: true, item: legacyMapping.item }
    : { success: false, reason: 'lossy_legacy_mapping' };
}

export function createDefaultKnowledgeItemId(input: KnowledgeItemIdInput): string {
  return createKnowledgeItemId(input);
}

export function getKnowledgeItemValidationIssues(item: unknown): KnowledgeItemValidationIssue[] {
  const result = validateKnowledgeItemV1(item);
  return result.success ? [] : result.issues;
}

function toKnowledgeItemSource(
  source: LinkItem['source'],
  sourceFallback: KnowledgeItemSource = 'legacy_unknown'
): KnowledgeItemSource {
  switch (source) {
    case 'chrome_bookmark':
      return 'chrome_bookmark';
    case 'reading_list':
      return 'chrome_reading_list';
    case 'current_page':
      return 'current_page';
    case 'context_menu':
      return 'context_menu';
    case 'import':
    case undefined:
      return sourceFallback;
  }
}

function toLegacyCaptureSource(source: KnowledgeItemSource): LinkCaptureSource | undefined {
  switch (source) {
    case 'chrome_bookmark':
      return 'chrome_bookmark';
    case 'chrome_reading_list':
      return 'reading_list';
    case 'current_page':
      return 'current_page';
    case 'context_menu':
      return 'context_menu';
    case 'legacy_unknown':
      return undefined;
  }
}

function normalizeDateAdded(dateAdded: string | undefined, fallback: string): string {
  if (!dateAdded) {
    return fallback;
  }

  const parsed = Date.parse(dateAdded);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function collectLegacyMappingLosses(item: KnowledgeItemV1): LegacyMappingLoss[] {
  const losses: LegacyMappingLoss[] = [];

  if (item.content !== undefined) {
    losses.push({ field: 'content', code: 'unsupported_field' });
  }
  if (item.summary !== undefined) {
    losses.push({ field: 'summary', code: 'unsupported_field' });
  }
  if (item.topics.length > 0) {
    losses.push({ field: 'topics', code: 'unsupported_field' });
  }
  if (item.updatedAt !== undefined) {
    losses.push({ field: 'updatedAt', code: 'unsupported_field' });
  }
  if (item.user.note !== undefined) {
    losses.push({ field: 'user.note', code: 'unsupported_field' });
  }
  if (item.user.tags && !sameStringArray(item.user.tags, item.tags)) {
    losses.push({ field: 'user.tags', code: 'conflicting_user_tags' });
  }
  if (hasDefinedFields(item.ai)) {
    losses.push({ field: 'ai', code: 'unsupported_field' });
  }

  for (const key of Object.keys(item.metadata)) {
    if (!LEGACY_METADATA_KEYS.has(key)) {
      losses.push({ field: `metadata.${key}`, code: 'unsupported_metadata' });
    }
  }

  return losses;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasDefinedFields(value: object): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}
