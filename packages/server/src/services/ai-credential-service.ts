import type { AiProvider } from '@bookmark-assistant/types';
import { isAiProvider } from './ai-provider';
import type { CredentialCipher, EncryptedCredential } from './credential-cipher';
import { AI_PROVIDER_DEFAULT_MODELS } from './ai-provider-adapters';

export type AiCredentialStatus = 'verified' | 'invalid' | 'revoked';

export interface StoredAiProviderCredential extends EncryptedCredential {
  userId: string;
  provider: string;
  keyLastFour: string;
  credentialVersion: number;
  status: string;
  verifiedAt: Date | null;
}

export interface AiCredentialStore {
  resolveInternalUserId(userId: string): Promise<string | undefined>;
  findCredential(userId: string): Promise<StoredAiProviderCredential | undefined>;
  saveCredential(credential: StoredAiProviderCredential): Promise<void>;
  deleteCredential(userId: string): Promise<void>;
  stopTasksForDeletedCredential(userId: string): Promise<void>;
  reconcileTasksWithActiveCredential(
    userId: string,
    credential: Pick<StoredAiProviderCredential, 'provider' | 'credentialVersion'> & { model: string }
  ): Promise<void>;
}

export interface AiCredentialSummary {
  provider: AiProvider;
  keyLastFour: string;
  credentialVersion: number;
  status: AiCredentialStatus;
  verifiedAt: Date | null;
}

export interface ActiveAiProviderCredential {
  provider: AiProvider;
  apiKey: string;
  credentialVersion: number;
}

export class AiCredentialNotFoundError extends Error {
  constructor() {
    super('AI provider credential was not found.');
    this.name = 'AiCredentialNotFoundError';
  }
}

class AiCredentialRecordError extends Error {
  constructor() {
    super('AI provider credential record is invalid.');
    this.name = 'AiCredentialRecordError';
  }
}

/**
 * Keeps provider keys behind a minimal boundary: callers can save a verified key,
 * inspect only redacted metadata, or obtain plaintext immediately before a provider call.
 */
export class AiCredentialService {
  constructor(
    private readonly store: AiCredentialStore,
    private readonly cipher: CredentialCipher
  ) {}

  async saveVerifiedCredential(
    externalUserId: string,
    provider: AiProvider,
    apiKey: string,
    verifiedAt = new Date()
  ): Promise<AiCredentialSummary> {
    const userId = await this.requireInternalUserId(externalUserId);
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      throw new AiCredentialRecordError();
    }

    const current = await this.store.findCredential(userId);
    const credentialVersion = (current?.credentialVersion ?? 0) + 1;
    const encrypted = this.cipher.encrypt(normalizedKey, { userId, provider, credentialVersion });
    const credential: StoredAiProviderCredential = {
      userId,
      provider,
      keyLastFour: redactKey(normalizedKey),
      credentialVersion,
      status: 'verified',
      verifiedAt,
      ...encrypted,
    };

    await this.store.saveCredential(credential);
    // This also runs for the first credential after deletion: durable tasks may
    // still be fenced to the deleted credential even though no current record exists.
    await this.store.reconcileTasksWithActiveCredential(userId, {
      provider,
      credentialVersion,
      model: AI_PROVIDER_DEFAULT_MODELS[provider],
    });
    return toSummary(credential);
  }

  /** Repairs stale durable tasks without decrypting or exposing the active key. */
  async reconcileTasksWithActiveCredential(externalUserId: string): Promise<void> {
    const userId = await this.requireInternalUserId(externalUserId);
    const credential = await this.store.findCredential(userId);
    if (!credential || credential.status !== 'verified' || !isAiProvider(credential.provider)) {
      throw new AiCredentialNotFoundError();
    }
    await this.store.reconcileTasksWithActiveCredential(userId, {
      provider: credential.provider,
      credentialVersion: credential.credentialVersion,
      model: AI_PROVIDER_DEFAULT_MODELS[credential.provider],
    });
  }

  async getCredentialSummary(externalUserId: string): Promise<AiCredentialSummary | undefined> {
    const userId = await this.requireInternalUserId(externalUserId);
    const credential = await this.store.findCredential(userId);
    return credential ? toSummary(credential) : undefined;
  }

  async getActiveCredential(externalUserId: string): Promise<ActiveAiProviderCredential> {
    const userId = await this.requireInternalUserId(externalUserId);
    const credential = await this.store.findCredential(userId);
    if (!credential || credential.status !== 'verified') {
      throw new AiCredentialNotFoundError();
    }
    if (!isAiProvider(credential.provider)) {
      throw new AiCredentialRecordError();
    }

    const apiKey = this.cipher.decrypt(credential, {
      userId,
      provider: credential.provider,
      credentialVersion: credential.credentialVersion,
    });
    return { provider: credential.provider, apiKey, credentialVersion: credential.credentialVersion };
  }

  async deleteCredential(externalUserId: string): Promise<void> {
    const userId = await this.requireInternalUserId(externalUserId);
    await this.store.deleteCredential(userId);
    await this.store.stopTasksForDeletedCredential(userId);
  }

  private async requireInternalUserId(externalUserId: string): Promise<string> {
    const userId = await this.store.resolveInternalUserId(externalUserId);
    if (!userId) {
      throw new AiCredentialNotFoundError();
    }
    return userId;
  }
}

function redactKey(apiKey: string): string {
  return apiKey.slice(-4);
}

function toSummary(credential: StoredAiProviderCredential): AiCredentialSummary {
  if (!isAiProvider(credential.provider) || !isCredentialStatus(credential.status)) {
    throw new AiCredentialRecordError();
  }

  return {
    provider: credential.provider,
    keyLastFour: credential.keyLastFour,
    credentialVersion: credential.credentialVersion,
    status: credential.status,
    verifiedAt: credential.verifiedAt,
  };
}

function isCredentialStatus(value: string): value is AiCredentialStatus {
  return value === 'verified' || value === 'invalid' || value === 'revoked';
}
