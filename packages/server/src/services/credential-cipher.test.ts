import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialCipherConfigurationError,
  CredentialCipherIntegrityError,
  createCredentialCipher,
} from './credential-cipher';

function createConfig(activeKeyVersion = 1, versions = [1]) {
  return {
    available: true as const,
    activeKeyVersion,
    keys: new Map(versions.map((version) => [version, randomBytes(32)])),
  };
}

const context = {
  userId: 'user_123',
  provider: 'openai' as const,
  credentialVersion: 1,
};

describe('credential cipher', () => {
  it('round trips a credential with authenticated encryption', () => {
    const cipher = createCredentialCipher(createConfig());
    const encrypted = cipher.encrypt('sk-example-secret', context);

    expect(encrypted.scheme).toBe('aes-256-gcm');
    expect(encrypted.ciphertext).not.toContain('sk-example-secret');
    expect(cipher.decrypt(encrypted, context)).toBe('sk-example-secret');
  });

  it('binds ciphertext to its user, provider, and credential version', () => {
    const cipher = createCredentialCipher(createConfig());
    const encrypted = cipher.encrypt('sk-example-secret', context);

    expect(() => cipher.decrypt(encrypted, { ...context, userId: 'user_456' })).toThrow(
      CredentialCipherIntegrityError
    );
    expect(() => cipher.decrypt(encrypted, { ...context, provider: 'gemini' })).toThrow(
      CredentialCipherIntegrityError
    );
    expect(() => cipher.decrypt(encrypted, { ...context, credentialVersion: 2 })).toThrow(
      CredentialCipherIntegrityError
    );
  });

  it('rejects tampered ciphertext and authentication tags', () => {
    const cipher = createCredentialCipher(createConfig());
    const encrypted = cipher.encrypt('sk-example-secret', context);

    expect(() =>
      cipher.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext}x` }, context)
    ).toThrow(CredentialCipherIntegrityError);
    expect(() =>
      cipher.decrypt(
        { ...encrypted, authenticationTag: `${encrypted.authenticationTag}x` },
        context
      )
    ).toThrow(CredentialCipherIntegrityError);
  });

  it('can read ciphertext from an earlier configured key version', () => {
    const keyring = createConfig(1, [1, 2]);
    const v1Cipher = createCredentialCipher(keyring);
    const encrypted = v1Cipher.encrypt('sk-example-secret', context);

    const v2Cipher = createCredentialCipher({ ...keyring, activeKeyVersion: 2 });
    expect(v2Cipher.decrypt(encrypted, context)).toBe('sk-example-secret');
    expect(v2Cipher.encrypt('sk-next-secret', context).keyVersion).toBe(2);
  });

  it('fails closed when encryption is not configured', () => {
    expect(() =>
      createCredentialCipher({
        available: false,
        reason: 'AI credential encryption keys are not configured.',
      })
    ).toThrow(CredentialCipherConfigurationError);
  });
});
