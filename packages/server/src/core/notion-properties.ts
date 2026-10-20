import type { LinkItem, LinkItemType, NotionLinkField, ReadState } from '@bookmark-assistant/types';
import { isValidUrl } from './urls';

export interface NotionSchemaProperty {
  type?: string;
}

export type NotionPropertySchema = Record<string, NotionSchemaProperty | undefined>;

export interface NotionRichTextFragmentLike {
  plain_text?: unknown;
  text?: {
    content?: unknown;
  };
}

export interface NotionMultiSelectOptionLike {
  name?: unknown;
}

export interface NotionPagePropertyValueLike {
  type?: unknown;
  url?: unknown;
  rich_text?: unknown;
  multi_select?: unknown;
  select?: unknown;
  single_select?: unknown;
  status?: unknown;
}

export type NotionPagePropertiesLike = Record<string, NotionPagePropertyValueLike | undefined>;

export interface NotionPageLike {
  created_time?: unknown;
  last_edited_time?: unknown;
  properties?: unknown;
}

export interface ExtractNotionPageLinkKeysResult {
  url?: string;
  syncId?: string;
  type?: LinkItemType;
  readState?: ReadState;
}

export interface ExtractNotionPageFolderAndTagsOptions {
  folderPropertyName?: string;
  tagsPropertyName?: string;
  defaultFolder?: string;
}

export interface ExtractNotionPageFolderAndTagsResult {
  folder: string;
  tags: string[];
}

export interface ExtractNotionPageTimestampsResult {
  createdTime?: string;
  lastEditedTime?: string;
}

export interface BuildBookmarkPropertiesOptions {
  defaultDate?: string | (() => string);
  fallbackTitlePropertyName?: string;
}

interface PropertyMatcher {
  bookmarkField: NotionLinkField;
  type: string | string[];
  patterns: RegExp[];
  required: boolean;
  allowTypeFallback?: boolean;
  builder: (
    value: unknown,
    options: BuildBookmarkPropertiesOptions,
    propertyName: string,
    propertyType: string,
    bookmark: LinkItem
  ) => unknown;
}

const READ_ONLY_PROPERTY_TYPES = new Set([
  'formula',
  'rollup',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
]);

const PROPERTY_MAPPING_CONFIG: PropertyMatcher[] = [
  {
    bookmarkField: 'title',
    type: 'title',
    patterns: [/^name$/i, /^title$/i],
    required: true,
    builder: (value) => ({
      title: [{ text: { content: stringOr(value, 'Untitled Bookmark') } }],
    }),
  },
  {
    bookmarkField: 'url',
    type: 'url',
    patterns: [/^url$/i, /^link$/i, /^website$/i],
    required: false,
    builder: (value) => ({ url: stringOr(value, '') }),
  },
  {
    bookmarkField: 'tags',
    type: 'multi_select',
    patterns: [/tag/i, /label/i, /category/i, /topic/i],
    required: false,
    builder: (value) => ({
      multi_select: Array.isArray(value)
        ? value.filter((tag): tag is string => typeof tag === 'string').map((name) => ({ name }))
        : [],
    }),
  },
  {
    bookmarkField: 'description',
    type: 'rich_text',
    patterns: [/desc/i, /summary/i, /note/i, /content/i],
    required: false,
    builder: (value) => ({ rich_text: [{ text: { content: stringOr(value, '') } }] }),
  },
  {
    bookmarkField: 'path',
    type: 'rich_text',
    patterns: [/folder/i, /path/i, /location/i, /directory/i],
    required: false,
    builder: (value) => ({ rich_text: [{ text: { content: stringOr(value, '') } }] }),
  },
  {
    bookmarkField: 'dateAdded',
    type: 'date',
    patterns: [/date/i, /created/i, /added/i, /time/i],
    required: false,
    builder: (value, options) => ({
      date: { start: stringOr(value, resolveDefaultDate(options)) },
    }),
  },
  {
    bookmarkField: 'syncId',
    type: 'rich_text',
    patterns: [/sync.*id/i, /identifier/i, /^id$/i],
    required: false,
    builder: (value) => ({ rich_text: [{ text: { content: stringOr(value, '') } }] }),
  },
  {
    bookmarkField: 'source',
    type: ['select', 'single_select'],
    patterns: [/^source$/i, /source/i],
    required: true,
    allowTypeFallback: false,
    builder: (value, _options, _propertyName, propertyType, bookmark) =>
      buildSelectProperty(
        value === 'reading_list' || bookmark.type === 'reading_list' ? 'ReadingList' : 'Bookmark',
        propertyType
      ),
  },
  {
    bookmarkField: 'type',
    type: ['select', 'single_select'],
    patterns: [/^type$/i, /type/i],
    required: false,
    builder: (value, _options, _propertyName, propertyType) =>
      buildSelectProperty(value === 'reading_list' ? 'Reading List' : 'Bookmark', propertyType),
  },
  {
    bookmarkField: 'readState',
    type: 'status',
    patterns: [/read.*state/i, /status/i],
    required: false,
    allowTypeFallback: false,
    builder: (value) => ({
      status: value === 'READ' ? { name: 'Done' } : { name: 'Unread' },
    }),
  },
  {
    bookmarkField: 'readState',
    type: ['select', 'single_select'],
    patterns: [/read.*state/i, /^status$/i],
    required: false,
    allowTypeFallback: false,
    builder: (value, _options, _propertyName, propertyType) =>
      buildSelectProperty(value === 'READ' ? 'Done' : 'Unread', propertyType),
  },
];

export function isReadOnlyNotionPropertyType(type: unknown): boolean {
  return typeof type === 'string' && READ_ONLY_PROPERTY_TYPES.has(type);
}

export function extractNotionPageLinkKeys(
  page: NotionPageLike | null | undefined
): ExtractNotionPageLinkKeysResult {
  const properties = normalizePageProperties(page?.properties);

  return {
    url: extractNotionPageUrl(properties),
    syncId: extractNotionPageSyncId(properties),
    type: extractNotionPageType(properties),
    readState: extractNotionPageReadState(properties),
  };
}

export function extractNotionPageFolderAndTags(
  page: NotionPageLike | null | undefined,
  options: ExtractNotionPageFolderAndTagsOptions = {}
): ExtractNotionPageFolderAndTagsResult {
  const properties = normalizePageProperties(page?.properties);
  const folderPropertyName = options.folderPropertyName || 'Folder';
  const tagsPropertyName = options.tagsPropertyName || 'Tags';
  const defaultFolder = options.defaultFolder || 'Default';

  return {
    folder: getNotionRichTextPlainText(properties[folderPropertyName]?.rich_text) || defaultFolder,
    tags: getNotionMultiSelectNames(properties[tagsPropertyName]?.multi_select),
  };
}

export function buildBookmarkPropertiesFromNotionSchema(
  schema: NotionPropertySchema,
  bookmark: LinkItem,
  options: BuildBookmarkPropertiesOptions = {}
): Record<string, unknown> {
  const writableEntries = Object.entries(schema).filter(
    ([, propDef]) => !isReadOnlyNotionPropertyType(propDef?.type)
  );
  const properties: Record<string, unknown> = {};

  for (const matcher of PROPERTY_MAPPING_CONFIG) {
    const bookmarkValue = bookmark[matcher.bookmarkField];
    if (!shouldBuildProperty(matcher, bookmarkValue, options)) {
      continue;
    }

    const propertyName = findPropertyName(matcher, writableEntries, options);
    if (propertyName) {
      if (properties[propertyName] !== undefined) {
        continue;
      }
      const propertyType = schema[propertyName]?.type || firstMatcherType(matcher.type);
      properties[propertyName] = matcher.builder(
        bookmarkValue,
        options,
        propertyName,
        propertyType,
        bookmark
      );
    }
  }

  return properties;
}

function findPropertyName(
  matcher: PropertyMatcher,
  writableEntries: Array<[string, NotionSchemaProperty | undefined]>,
  options: BuildBookmarkPropertiesOptions
): string | undefined {
  for (const pattern of matcher.patterns) {
    const match = writableEntries.find(
      ([name, propDef]) => propertyTypeMatches(propDef?.type, matcher.type) && pattern.test(name)
    )?.[0];
    if (match) {
      return match;
    }
  }

  const allowTypeFallback = matcher.allowTypeFallback !== false;
  const typeMatch = allowTypeFallback
    ? writableEntries.find(([, propDef]) => propertyTypeMatches(propDef?.type, matcher.type))?.[0]
    : undefined;
  if (typeMatch) {
    return typeMatch;
  }

  if (matcher.required && propertyTypeMatches('title', matcher.type)) {
    return options.fallbackTitlePropertyName || 'Name';
  }

  return undefined;
}

function shouldBuildProperty(
  matcher: PropertyMatcher,
  value: unknown,
  options: BuildBookmarkPropertiesOptions
): boolean {
  if (matcher.required) {
    return true;
  }

  if (matcher.bookmarkField === 'dateAdded' && options.defaultDate !== undefined) {
    return true;
  }

  return value !== undefined && value !== null && value !== '';
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function resolveDefaultDate(options: BuildBookmarkPropertiesOptions): string {
  if (typeof options.defaultDate === 'function') {
    return options.defaultDate();
  }
  return options.defaultDate || new Date().toISOString();
}

function firstMatcherType(type: string | string[]): string {
  return Array.isArray(type) ? type[0] : type;
}

function propertyTypeMatches(propertyType: unknown, matcherType: string | string[]): boolean {
  if (typeof propertyType !== 'string') {
    return false;
  }
  const allowedTypes = Array.isArray(matcherType) ? matcherType : [matcherType];
  return allowedTypes.includes(propertyType);
}

function buildSelectProperty(name: string, propertyType: string): unknown {
  return propertyType === 'select' ? { select: { name } } : { single_select: { name } };
}

function normalizePageProperties(properties: unknown): NotionPagePropertiesLike {
  return properties && typeof properties === 'object'
    ? (properties as NotionPagePropertiesLike)
    : {};
}

function extractNotionPageUrl(properties: NotionPagePropertiesLike): string | undefined {
  for (const propDef of Object.values(properties)) {
    if (propDef?.type === 'url' && typeof propDef.url === 'string' && propDef.url.length > 0) {
      return propDef.url;
    }

    if (propDef?.type === 'rich_text') {
      const text = getNotionRichTextPlainText(propDef.rich_text);
      if (text && isValidUrl(text)) {
        return text;
      }
    }
  }

  return undefined;
}

function extractNotionPageSyncId(properties: NotionPagePropertiesLike): string | undefined {
  for (const [propName, propDef] of Object.entries(properties)) {
    if (propDef?.type !== 'rich_text' || !isSyncIdPropertyName(propName)) {
      continue;
    }

    const text = getNotionRichTextPlainText(propDef.rich_text);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractNotionPageType(properties: NotionPagePropertiesLike): LinkItemType | undefined {
  for (const [propName, propDef] of Object.entries(properties)) {
    if (
      (propDef?.type !== 'select' && propDef?.type !== 'single_select') ||
      !(/type/i.test(propName) || /source/i.test(propName))
    ) {
      continue;
    }

    const name = getNotionNamedOption(
      propDef.type === 'select' ? propDef.select : propDef.single_select
    );
    if (/reading\s*list/i.test(name) || /readinglist/i.test(name)) {
      return 'reading_list';
    }
    if (/bookmark/i.test(name)) {
      return 'bookmark';
    }
  }

  return undefined;
}

function extractNotionPageReadState(properties: NotionPagePropertiesLike): ReadState | undefined {
  for (const [propName, propDef] of Object.entries(properties)) {
    if (
      (propDef?.type !== 'status' &&
        propDef?.type !== 'select' &&
        propDef?.type !== 'single_select') ||
      !(/read.*state/i.test(propName) || /status/i.test(propName))
    ) {
      continue;
    }

    const option =
      propDef.type === 'status'
        ? propDef.status
        : propDef.type === 'select'
          ? propDef.select
          : propDef.single_select;
    const name = getNotionNamedOption(option);
    if (/^read$/i.test(name) || /done/i.test(name) || /finished/i.test(name)) {
      return 'READ';
    }
    if (
      /unread/i.test(name) ||
      /to\s*read/i.test(name) ||
      /not\s*read/i.test(name) ||
      /^reading$/i.test(name)
    ) {
      return 'UNREAD';
    }
  }

  return undefined;
}

function getNotionRichTextPlainText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((fragment: NotionRichTextFragmentLike) =>
      typeof fragment?.plain_text === 'string'
        ? fragment.plain_text
        : typeof fragment?.text?.content === 'string'
          ? fragment.text.content
          : ''
    )
    .join('')
    .trim();
}

function getNotionMultiSelectNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option: NotionMultiSelectOptionLike) =>
      typeof option?.name === 'string' ? option.name : undefined
    )
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

function getNotionNamedOption(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const option = value as { name?: unknown };
  return typeof option.name === 'string' ? option.name : '';
}

function isSyncIdPropertyName(propName: string): boolean {
  return /sync.*id/i.test(propName) || /identifier/i.test(propName) || propName === 'id';
}
