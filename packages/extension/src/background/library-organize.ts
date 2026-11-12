import { isExtensionPageSender } from '../utils/message';
import { AI_PROVIDERS, isAiProvider, type AiProvider } from '@bookmark-assistant/types';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  AiProviderGenerationError,
  AiProviderValidationError,
  createAiProviderAdapter,
  type FetchLike,
} from '../ai/providers';
import {
  ORGANIZE_BATCH_SIZE,
  ORGANIZE_MAX_FOLDERS,
  OrganizeResponseError,
  buildAssignPrompt,
  buildFolderMapPrompt,
  isOrganizeCategoryId,
  parseAssignResponse,
  parseFolderMapResponse,
  toShareableBookmarkUrl,
  type OrganizeAssignment,
  type OrganizeFolderMap,
  type OrganizeFolderMapRequest,
  type OrganizeItem,
} from '../core';

/**
 * The organize key stays on this device and is sent only to the chosen provider.
 * It is not account-scoped: library organization never requires an account.
 */
export const LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY =
  'library_organize_provider_credential_v1';
const API_KEY_MAX_LENGTH = 512;
// Without reasoning, a 20-item answer needs well under 1,500 tokens.
const ASSIGN_MAX_OUTPUT_TOKENS = 3_000;
const FOLDER_MAP_MAX_OUTPUT_TOKENS = 2_000;
const SAMPLE_TITLES_MAX = 4;

interface StoredOrganizeKey {
  provider: AiProvider;
  apiKey: string;
  savedAt: string;
}

export interface OrganizeKeySummary {
  provider: AiProvider;
  last4: string;
}

export type OrganizeErrorCode =
  | 'invalid_request'
  | 'not_configured'
  | 'permission_required'
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'model_access'
  | 'rate_limited'
  | 'service_unavailable'
  | 'provider_request_failed'
  | 'invalid_provider_response'
  | 'invalid_response';

export class OrganizeError extends Error {
  readonly code: OrganizeErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: OrganizeErrorCode, retryAfterMs?: number) {
    super(`Library organization failed: ${code}.`);
    this.name = 'OrganizeError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Content scripts run inside web pages and must never spend the user's key. */
export function isOrganizeSenderAllowed(sender: chrome.runtime.MessageSender): boolean {
  return isExtensionPageSender(sender);
}

export async function readOrganizeKeySummary(): Promise<OrganizeKeySummary | null> {
  const stored = await readStoredKey();
  return stored ? summarize(stored) : null;
}

export async function saveOrganizeKey(
  provider: unknown,
  apiKey: unknown,
  fetcher: FetchLike = fetch
): Promise<OrganizeKeySummary> {
  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!isAiProvider(provider) || !trimmedKey || trimmedKey.length > API_KEY_MAX_LENGTH) {
    throw new OrganizeError('invalid_request');
  }
  await assertProviderPermission(provider);
  const previous = await readStoredKey();
  try {
    await createAiProviderAdapter(provider, fetcher, undefined, undefined, {
      browserClient: true,
    }).validateApiKey(trimmedKey);
  } catch (error) {
    // Keep only the access a stored key still needs.
    if (previous?.provider !== provider) await releaseProviderPermissions([provider]);
    if (error instanceof AiProviderValidationError) throw new OrganizeError(error.code);
    throw error;
  }
  const stored: StoredOrganizeKey = {
    provider,
    apiKey: trimmedKey,
    savedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY]: stored });
  await releaseProviderPermissions(AI_PROVIDERS.filter((candidate) => candidate !== provider));
  return summarize(stored);
}

export async function deleteOrganizeKey(): Promise<void> {
  await chrome.storage.local.remove(LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY);
  await releaseProviderPermissions(AI_PROVIDERS);
}

/** Releasing origins is a courtesy; a failure must never keep or restore a key. */
async function releaseProviderPermissions(providers: readonly AiProvider[]): Promise<void> {
  await chrome.permissions
    .remove({ origins: providers.map((provider) => AI_PROVIDER_HOST_PERMISSIONS[provider]) })
    .catch(() => false);
}

/** Step 1: which existing folders already serve a category. */
export async function runFolderMap(
  request: OrganizeFolderMapRequest,
  fetcher: FetchLike = fetch
): Promise<{ folderMap: OrganizeFolderMap }> {
  if (!isValidFolderMapRequest(request)) throw new OrganizeError('invalid_request');
  const text = await generate(buildFolderMapPrompt(request), FOLDER_MAP_MAX_OUTPUT_TOKENS, fetcher);
  return { folderMap: parseOrThrow(() => parseFolderMapResponse(text, request)) };
}

/** Step 2: a category for every bookmark in one batch. */
export async function runAssignBatch(
  items: OrganizeItem[],
  uiLanguage: string,
  fetcher: FetchLike = fetch
): Promise<{ assignments: OrganizeAssignment[] }> {
  if (!isValidItems(items)) throw new OrganizeError('invalid_request');
  const text = await generate(
    buildAssignPrompt(items, uiLanguage),
    ASSIGN_MAX_OUTPUT_TOKENS,
    fetcher
  );
  return { assignments: parseOrThrow(() => parseAssignResponse(text, items)) };
}

async function generate(prompt: string, maxOutputTokens: number, fetcher: FetchLike) {
  const stored = await readStoredKey();
  if (!stored) throw new OrganizeError('not_configured');
  await assertProviderPermission(stored.provider);
  const adapter = createAiProviderAdapter(stored.provider, fetcher, undefined, undefined, {
    browserClient: true,
  });
  try {
    // Classification needs no long reasoning, and the worker cannot wait for it.
    return (
      await adapter.generate(stored.apiKey, prompt, {
        maxOutputTokens,
        lowLatency: true,
        deterministic: true,
      })
    ).text;
  } catch (error) {
    if (error instanceof AiProviderGenerationError) {
      throw new OrganizeError(error.code, error.retryAfterMs);
    }
    throw error;
  }
}

function parseOrThrow<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof OrganizeResponseError) throw new OrganizeError('invalid_response');
    throw error;
  }
}

async function assertProviderPermission(provider: AiProvider): Promise<void> {
  const granted = await chrome.permissions.contains({
    origins: [AI_PROVIDER_HOST_PERMISSIONS[provider]],
  });
  if (!granted) throw new OrganizeError('permission_required');
}

async function readStoredKey(): Promise<StoredOrganizeKey | undefined> {
  const value = (await chrome.storage.local.get(LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY))[
    LIBRARY_ORGANIZE_PROVIDER_CREDENTIAL_STORAGE_KEY
  ] as Partial<StoredOrganizeKey> | undefined;
  if (!value || !isAiProvider(value.provider) || typeof value.apiKey !== 'string') return undefined;
  if (!value.apiKey) return undefined;
  return { provider: value.provider, apiKey: value.apiKey, savedAt: String(value.savedAt ?? '') };
}

function summarize(stored: StoredOrganizeKey): OrganizeKeySummary {
  return { provider: stored.provider, last4: stored.apiKey.slice(-4) };
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** The Options page builds batches, but the worker re-checks what leaves the device. */
function isValidItems(items: OrganizeItem[]): boolean {
  if (!Array.isArray(items) || !items.length || items.length > ORGANIZE_BATCH_SIZE) return false;
  return items.every(
    (item) =>
      isText(item?.id) &&
      isText(item.parentId) &&
      isText(item.title) &&
      isText(item.folderPath) &&
      isText(item.url) &&
      toShareableBookmarkUrl(item.url) === item.url &&
      (item.currentCategory === undefined || isOrganizeCategoryId(item.currentCategory))
  );
}

function isValidFolderMapRequest(request: OrganizeFolderMapRequest): boolean {
  const folders = request?.folders;
  if (!Array.isArray(folders) || folders.length > ORGANIZE_MAX_FOLDERS) return false;
  return folders.every(
    (folder) =>
      isText(folder?.id) &&
      isText(folder.path) &&
      Number.isInteger(folder.bookmarkCount) &&
      Array.isArray(folder.sampleTitles) &&
      folder.sampleTitles.length <= SAMPLE_TITLES_MAX &&
      folder.sampleTitles.every(isText)
  );
}
