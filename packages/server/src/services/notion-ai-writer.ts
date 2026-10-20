import { createHash } from 'crypto';
import type { AiModelOutput } from '@bookmark-assistant/types';

export interface NotionAiPropertySettings {
  descriptionPropertyId: string;
  tagsPropertyId: string;
}

export interface NotionPageForAi {
  id: string;
  properties: Record<string, unknown>;
  parent?: Record<string, unknown>;
  archived?: boolean;
  in_trash?: boolean;
}

export type NotionAiWritePreparation =
  | { action: 'write'; properties: Record<string, unknown>; descriptionBaselineHash: string }
  | {
      action: 'write_tags_only';
      properties: Record<string, unknown>;
      descriptionBaselineHash: string;
    };

export class NotionAiWriteError extends Error {
  constructor(public readonly code: 'target_unavailable' | 'invalid_output') {
    super(`Notion AI write preparation failed: ${code}.`);
    this.name = 'NotionAiWriteError';
  }
}

/**
 * Produces a Notion property update that never replaces a user-edited description.
 * Tags are merged independently: adding model-generated tags cannot erase a user's
 * existing tags, so it remains safe even when the description is protected.
 */
export function prepareNotionAiWrite(
  page: NotionPageForAi,
  settings: NotionAiPropertySettings,
  output: AiModelOutput,
  expectedDescriptionBaselineHash?: string
): NotionAiWritePreparation {
  if (output.status !== 'ok' || !output.summary.trim() || output.tags.length < 1) {
    throw new NotionAiWriteError('invalid_output');
  }
  const description = findProperty(page.properties, settings.descriptionPropertyId, 'rich_text');
  const tags = findProperty(page.properties, settings.tagsPropertyId, 'multi_select');
  if (!description || !tags) throw new NotionAiWriteError('target_unavailable');

  const currentDescription = richTextPlainText(description.value);
  const currentHash = createDescriptionBaselineHash(currentDescription);
  const canReplaceDescription =
    !currentDescription || currentHash === expectedDescriptionBaselineHash;
  const mergedTags = mergeNotionTags(multiSelectNames(tags.value), output.tags);
  if (!canReplaceDescription) {
    return {
      action: 'write_tags_only',
      descriptionBaselineHash: currentHash,
      properties: {
        [tags.id]: { multi_select: mergedTags.map((name) => ({ name })) },
      },
    };
  }
  return {
    action: 'write',
    descriptionBaselineHash: currentHash,
    properties: {
      [description.id]: {
        rich_text: [{ type: 'text', text: { content: output.summary.trim() } }],
      },
      [tags.id]: { multi_select: mergedTags.map((name) => ({ name })) },
    },
  };
}

export function createDescriptionBaselineHash(description: string): string {
  return createHash('sha256').update(normalizeText(description), 'utf8').digest('base64url');
}

/** Captures the exact Description state that AI may safely replace later. */
export function getDescriptionBaselineHash(
  page: NotionPageForAi,
  settings: NotionAiPropertySettings
): string | undefined {
  const description = findProperty(page.properties, settings.descriptionPropertyId, 'rich_text');
  return description
    ? createDescriptionBaselineHash(richTextPlainText(description.value))
    : undefined;
}

/** Confirms whether a possibly-ambiguous Notion update reached the page. */
export function doesNotionPageMatchAiOutput(
  page: NotionPageForAi,
  settings: NotionAiPropertySettings,
  output: AiModelOutput
): boolean {
  if (output.status !== 'ok') return false;
  const description = findProperty(page.properties, settings.descriptionPropertyId, 'rich_text');
  const tags = findProperty(page.properties, settings.tagsPropertyId, 'multi_select');
  if (!description || !tags) return false;
  const currentDescription = normalizeText(richTextPlainText(description.value));
  const currentTags = new Set(multiSelectNames(tags.value).map((tag) => tag.toLocaleLowerCase()));
  return (
    currentDescription === normalizeText(output.summary) &&
    output.tags.every((tag) => currentTags.has(tag.trim().toLocaleLowerCase()))
  );
}

function findProperty(
  properties: Record<string, unknown>,
  propertyId: string,
  expectedType: string
): { id: string; value: Record<string, unknown> } | undefined {
  for (const property of Object.values(properties)) {
    if (!property || typeof property !== 'object') continue;
    const value = property as Record<string, unknown>;
    if (value.id === propertyId && value.type === expectedType) return { id: propertyId, value };
  }
  return undefined;
}

function richTextPlainText(value: Record<string, unknown>): string {
  const fragments = Array.isArray(value.rich_text) ? value.rich_text : [];
  return fragments
    .map((fragment) => {
      if (!fragment || typeof fragment !== 'object') return '';
      const record = fragment as Record<string, unknown>;
      return typeof record.plain_text === 'string'
        ? record.plain_text
        : typeof (record.text as Record<string, unknown> | undefined)?.content === 'string'
          ? ((record.text as Record<string, unknown>).content as string)
          : '';
    })
    .join('');
}

function multiSelectNames(value: Record<string, unknown>): string[] {
  const options = Array.isArray(value.multi_select) ? value.multi_select : [];
  return options.flatMap((option) => {
    const name =
      option && typeof option === 'object' ? (option as Record<string, unknown>).name : undefined;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
}

function mergeNotionTags(current: string[], generated: string[]): string[] {
  const tags = [...current];
  const seen = new Set(current.map((tag) => tag.toLocaleLowerCase()));
  for (const tag of generated) {
    const normalized = tag.trim();
    if (!normalized || seen.has(normalized.toLocaleLowerCase())) continue;
    seen.add(normalized.toLocaleLowerCase());
    tags.push(normalized);
  }
  return tags;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
