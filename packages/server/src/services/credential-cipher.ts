import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { AiProvider } from '@bookmark-assistant/types';
import type { AiCredentialEncryptionConfig } from '../config';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export interface CredentialEncryptionContext {
  userId: string;
  provider: AiProvider;
  credentialVersion: number;
}

export interface EncryptedCredential {
  scheme: typeof CIPHER_ALGORITHM;
  keyVersion: number;
  initializationVector: string;
  authenticationTag: string;
  ciphertext: string;
}

export class CredentialCipherConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCipherConfigurationError';
  }
}

export class CredentialCipherIntegrityError extends Error {
  constructor() {
    super('Unable to decrypt credential.');
    this.name = 'CredentialCipherIntegrityError';
  }
}

export interface CredentialCipher {
  encrypt(plaintext: string, context: CredentialEncryptionContext): EncryptedCredential;
  decrypt(payload: EncryptedCredential, context: CredentialEncryptionContext): string;
}

export function createCredentialCipher(config: AiCredentialEncryptionConfig): CredentialCipher {
  if (!config.available) {
    throw new CredentialCipherConfigurationError(config.reason);
  }

  return new AesGcmCredentialCipher(config.activeKeyVersion, config.keys);
}

class AesGcmCredentialCipher implements CredentialCipher {
  constructor(
    private readonly activeKeyVersion: number,
    private readonly keys: ReadonlyMap<number, Buffer>
  ) {}

  encrypt(plaintext: string, context: CredentialEncryptionContext): EncryptedCredential {
    if (!plaintext) {
      throw new CredentialCipherConfigurationError('Credential plaintext must not be empty.');
    }

    const key = this.keys.get(this.activeKeyVersion);
    if (!key) {
      throw new CredentialCipherConfigurationError(
        'Active credential encryption key is unavailable.'
      );
    }

    const initializationVector = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(CIPHER_ALGORITHM, key, initializationVector, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    cipher.setAAD(buildAdditionalAuthenticatedData(context));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return {
      scheme: CIPHER_ALGORITHM,
      keyVersion: this.activeKeyVersion,
      initializationVector: initializationVector.toString('base64url'),
      authenticationTag: authenticationTag.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  }

  decrypt(payload: EncryptedCredential, context: CredentialEncryptionContext): string {
    if (payload.scheme !== CIPHER_ALGORITHM) {
      throw new CredentialCipherIntegrityError();
    }

    const key = this.keys.get(payload.keyVersion);
    if (!key) {
      throw new CredentialCipherConfigurationError(
        `Credential encryption key version ${payload.keyVersion} is unavailable.`
      );
    }

    try {
      const initializationVector = Buffer.from(payload.initializationVector, 'base64url');
      const authenticationTag = Buffer.from(payload.authenticationTag, 'base64url');
      const ciphertext = Buffer.from(payload.ciphertext, 'base64url');
      if (
        initializationVector.length !== IV_LENGTH_BYTES ||
        authenticationTag.length !== AUTH_TAG_LENGTH_BYTES ||
        ciphertext.length === 0
      ) {
        throw new Error('Invalid encrypted credential payload.');
      }

      const decipher = createDecipheriv(CIPHER_ALGORITHM, key, initializationVector, {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      });
      decipher.setAAD(buildAdditionalAuthenticatedData(context));
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof CredentialCipherConfigurationError) {
        throw error;
      }
      throw new CredentialCipherIntegrityError();
    }
  }
}

function buildAdditionalAuthenticatedData(context: CredentialEncryptionContext): Buffer {
  if (
    !context.userId ||
    !Number.isInteger(context.credentialVersion) ||
    context.credentialVersion <= 0
  ) {
    throw new CredentialCipherConfigurationError('Credential encryption context is invalid.');
  }

  return Buffer.from(
    [
      'bookmark-assistant-pro',
      'ai-provider-credential',
      context.userId,
      context.provider,
      String(context.credentialVersion),
    ].join('\u001f'),
    'utf8'
  );
}
