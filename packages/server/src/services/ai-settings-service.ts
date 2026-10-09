import type { NotionAiPropertySettings } from './notion-ai-writer';
import { isPrivateAddress } from './public-page-fetcher';

export interface AiSettings {
  singlePageEnabled: boolean;
  batchEnabled: boolean;
  properties?: NotionAiPropertySettings;
}

export interface AiSettingsStore {
  resolveInternalUserId(userId: string): Promise<string | undefined>;
  get(userId: string): Promise<AiSettings | undefined>;
  save(userId: string, settings: AiSettings): Promise<AiSettings>;
}

export class AiSettingsService {
  constructor(private readonly store: AiSettingsStore) {}

  async get(userId: string): Promise<AiSettings | undefined> {
    const internalUserId = await this.store.resolveInternalUserId(userId);
    return internalUserId ? this.store.get(internalUserId) : undefined;
  }

  async save(userId: string, settings: AiSettings): Promise<AiSettings | undefined> {
    const internalUserId = await this.store.resolveInternalUserId(userId);
    if (!internalUserId) return undefined;
    return this.store.save(internalUserId, normalizeSettings(settings));
  }
}

/** The legacy per-user toggle no longer disables AI for newly saved pages. */
export function isSinglePageAiConfigured(
  settings: AiSettings | undefined
): settings is AiSettings & { properties: NotionAiPropertySettings } {
  return Boolean(settings?.properties);
}

function normalizeSettings(settings: AiSettings): AiSettings {
  const properties = settings.properties?.descriptionPropertyId.trim() && settings.properties.tagsPropertyId.trim()
    ? { descriptionPropertyId: settings.properties.descriptionPropertyId.trim(), tagsPropertyId: settings.properties.tagsPropertyId.trim() }
    : undefined;
  return { singlePageEnabled: settings.singlePageEnabled, batchEnabled: settings.batchEnabled, properties };
}

export function isAiSourceDisallowed(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return true;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test')
  ) return true;
  if (isPrivateAddress(hostname)) return true;
  return false;
}
