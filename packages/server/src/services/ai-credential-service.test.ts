import { randomBytes } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createCredentialCipher } from './credential-cipher';
import {
  AiCredentialNotFoundError,
  AiCredentialService,
  type AiCredentialStore,
  type StoredAiProviderCredential,
} from './ai-credential-service';

function createStore(): AiCredentialStore & { records: Map<string, StoredAiProviderCredential> } {
  const records = new Map<string, StoredAiProviderCredential>();
  return {
    records,
    async resolveInternalUserId(userId) {
      return userId === 'missing-user' ? undefined : `internal-${userId}`;
    },
    async findCredential(userId) {
      return records.get(userId);
    },
    async saveCredential(credential) {
      records.set(credential.userId, credential);
    },
    async deleteCredential(userId) {
      records.delete(userId);
    },
    async stopTasksForDeletedCredential() {},
    reconcileTasksWithActiveCredential: vi.fn(async () => undefined),
  };
}

function createService() {
  const store = createStore();
  const cipher = createCredentialCipher({
    available: true,
    activeKeyVersion: 1,
    keys: new Map([[1, randomBytes(32)]]),
  });
  return { store, service: new AiCredentialService(store, cipher) };
}

describe('AiCredentialService', () => {
  it('stores only encrypted data and returns redacted metadata', async () => {
    const { store, service } = createService();
    const verifiedAt = new Date('2026-08-21T00:00:00.000Z');

    await expect(
      service.saveVerifiedCredential('user-a', 'openai', '  sk-live-1234  ', verifiedAt)
    ).resolves.toEqual({
      provider: 'openai',
      keyLastFour: '1234',
      credentialVersion: 1,
      status: 'verified',
      verifiedAt,
    });

    const stored = store.records.get('internal-user-a')!;
    expect(stored.ciphertext).not.toContain('sk-live-1234');
    await expect(service.getCredentialSummary('user-a')).resolves.toEqual({
      provider: 'openai',
      keyLastFour: '1234',
      credentialVersion: 1,
      status: 'verified',
      verifiedAt,
    });
    await expect(service.getActiveCredential('user-a')).resolves.toEqual({
      provider: 'openai',
      apiKey: 'sk-live-1234',
      credentialVersion: 1,
    });
    expect(store.reconcileTasksWithActiveCredential).toHaveBeenCalledWith('internal-user-a', {
      provider: 'openai',
      credentialVersion: 1,
      model: 'gpt-5-mini',
    });
  });

  it('increments the credential version and resumes pending work when a validated replacement is saved', async () => {
    const { store, service } = createService();

    await service.saveVerifiedCredential('user-a', 'openai', 'first-key-1234');
    await expect(
      service.saveVerifiedCredential('user-a', 'anthropic', 'second-key-5678')
    ).resolves.toMatchObject({
      provider: 'anthropic',
      credentialVersion: 2,
      keyLastFour: '5678',
    });
    await expect(service.getActiveCredential('user-a')).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'second-key-5678', // gitleaks:allow -- deterministic non-provider test fixture
      credentialVersion: 2,
    });
    expect(store.reconcileTasksWithActiveCredential).toHaveBeenLastCalledWith('internal-user-a', {
      provider: 'anthropic',
      credentialVersion: 2,
      model: 'claude-haiku-4-5',
    });
  });

  it('reconciles stale tasks from the active credential without decrypting it', async () => {
    const { store, service } = createService();
    await service.saveVerifiedCredential('user-a', 'openai', 'first-key-1234');
    vi.mocked(store.reconcileTasksWithActiveCredential).mockClear();

    await expect(service.reconcileTasksWithActiveCredential('user-a')).resolves.toBeUndefined();

    expect(store.reconcileTasksWithActiveCredential).toHaveBeenCalledWith('internal-user-a', {
      provider: 'openai',
      credentialVersion: 1,
      model: 'gpt-5-mini',
    });
  });

  it('deletes a credential and does not reveal a missing-user distinction', async () => {
    const { service } = createService();
    await service.saveVerifiedCredential('user-a', 'gemini', 'key-1234');
    await service.deleteCredential('user-a');

    await expect(service.getActiveCredential('user-a')).rejects.toBeInstanceOf(
      AiCredentialNotFoundError
    );
    await expect(service.getCredentialSummary('missing-user')).rejects.toBeInstanceOf(
      AiCredentialNotFoundError
    );
  });
});
