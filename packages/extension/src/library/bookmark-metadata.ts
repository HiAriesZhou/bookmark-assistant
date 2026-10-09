/// <reference types="chrome" />

export const BOOKMARK_METADATA_STORAGE_KEY = 'bookmark_library_metadata_v1';
export const BOOKMARK_DESCRIPTION_MAX_LENGTH = 2_000;
export const BOOKMARK_TAG_MAX_LENGTH = 40;
export const BOOKMARK_TAG_LIMIT = 20;

export interface LocalBookmarkMetadataV1 {
  description?: string;
  tags: string[];
  updatedAt: string;
}

interface LocalBookmarkMetadataStoreV1 {
  schemaVersion: 1;
  byBookmarkId: Record<string, LocalBookmarkMetadataV1>;
}

export interface LocalBookmarkMetadataInput {
  description?: string;
  tags: string[];
}

let writeQueue: Promise<void> = Promise.resolve();
const BOOKMARK_METADATA_WRITE_LOCK = 'bookmark-library-metadata-v1-write';

export async function readBookmarkMetadata(): Promise<Record<string, LocalBookmarkMetadataV1>> {
  const stored = await chrome.storage.local.get(BOOKMARK_METADATA_STORAGE_KEY);
  return parseMetadataStore(stored[BOOKMARK_METADATA_STORAGE_KEY]).byBookmarkId;
}

export function normalizeBookmarkTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const tag = rawTag.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > BOOKMARK_TAG_MAX_LENGTH) {
      throw new Error('BOOKMARK_TAG_TOO_LONG');
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }

  if (normalized.length > BOOKMARK_TAG_LIMIT) {
    throw new Error('TOO_MANY_BOOKMARK_TAGS');
  }
  return normalized;
}

export function normalizeBookmarkMetadata(
  input: LocalBookmarkMetadataInput,
  now: Date = new Date()
): LocalBookmarkMetadataV1 {
  const description = input.description?.trim() || undefined;
  if (description && description.length > BOOKMARK_DESCRIPTION_MAX_LENGTH) {
    throw new Error('BOOKMARK_DESCRIPTION_TOO_LONG');
  }

  return {
    ...(description ? { description } : {}),
    tags: normalizeBookmarkTags(input.tags),
    updatedAt: now.toISOString(),
  };
}

export function saveBookmarkMetadata(
  bookmarkId: string,
  input: LocalBookmarkMetadataInput,
  now: Date = new Date()
): Promise<LocalBookmarkMetadataV1> {
  const metadata = normalizeBookmarkMetadata(input, now);
  return enqueueWrite(async () => {
    const byBookmarkId = await readBookmarkMetadata();
    if (!metadata.description && metadata.tags.length === 0) delete byBookmarkId[bookmarkId];
    else byBookmarkId[bookmarkId] = metadata;
    await writeMetadata(byBookmarkId);
    return metadata;
  });
}

export function removeBookmarkMetadata(bookmarkId: string): Promise<void> {
  return enqueueWrite(async () => {
    const byBookmarkId = await readBookmarkMetadata();
    if (!(bookmarkId in byBookmarkId)) return;
    delete byBookmarkId[bookmarkId];
    await writeMetadata(byBookmarkId);
  });
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const lockedOperation = () => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks
      ? locks.request<Promise<T>>(BOOKMARK_METADATA_WRITE_LOCK, operation).then((result) => result)
      : operation();
  };
  const next = writeQueue.then(lockedOperation, lockedOperation);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function writeMetadata(byBookmarkId: Record<string, LocalBookmarkMetadataV1>): Promise<void> {
  const store: LocalBookmarkMetadataStoreV1 = { schemaVersion: 1, byBookmarkId };
  return chrome.storage.local.set({ [BOOKMARK_METADATA_STORAGE_KEY]: store });
}

function parseMetadataStore(value: unknown): LocalBookmarkMetadataStoreV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.byBookmarkId)) {
    return { schemaVersion: 1, byBookmarkId: {} };
  }

  const byBookmarkId: Record<string, LocalBookmarkMetadataV1> = {};
  for (const [bookmarkId, candidate] of Object.entries(value.byBookmarkId)) {
    if (!isRecord(candidate) || !Array.isArray(candidate.tags)) continue;
    if (!candidate.tags.every((tag) => typeof tag === 'string')) continue;
    if (candidate.description !== undefined && typeof candidate.description !== 'string') continue;
    if (
      typeof candidate.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.updatedAt))
    ) {
      continue;
    }
    try {
      byBookmarkId[bookmarkId] = normalizeBookmarkMetadata(
        { description: candidate.description, tags: candidate.tags },
        new Date(candidate.updatedAt)
      );
    } catch {
      // Ignore only the malformed entry; the rest of the local library remains usable.
    }
  }
  return { schemaVersion: 1, byBookmarkId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
