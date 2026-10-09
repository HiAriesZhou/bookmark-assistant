/**
 * Unit tests for server configuration parsing
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_SSLMODE',
  'DATABASE_CONNECTION_LIMIT',
  'JWT_SECRET',
  'NOTION_CLIENT_ID',
  'NOTION_CLIENT_SECRET',
  'ALLOWED_EXTENSION_ID',
  'ALLOWED_EXTENSION_IDS',
  'DEVELOPER_EMAILS',
  'WEBSITE_URL',
  'AI_CREDENTIAL_ENCRYPTION_KEYS',
  'AI_CREDENTIAL_ACTIVE_KEY_VERSION',
  'PADDLE_PRO_YEARLY_PRICE_ID',
  'SELF_HOSTED',
];

const originalEnv = { ...process.env };

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...originalEnv };
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'test-secret',
    NOTION_CLIENT_ID: 'test-client-id',
    NOTION_CLIENT_SECRET: 'test-client-secret',
    ...env,
  });

  return import('./index');
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('server config', () => {
  it('parses a versioned AES-256 credential keyring without exposing it in config errors', async () => {
    const { parseAiCredentialEncryptionConfig } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
    });
    const encodedKey = Buffer.alloc(32, 7).toString('base64url');

    const result = parseAiCredentialEncryptionConfig(`1:${encodedKey}`, '1');

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.activeKeyVersion).toBe(1);
      expect(result.keys.get(1)).toEqual(Buffer.alloc(32, 7));
    }
  });

  it('does not enable credential encryption for invalid key material', async () => {
    const { parseAiCredentialEncryptionConfig } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
    });

    const result = parseAiCredentialEncryptionConfig('1:not-a-32-byte-key', '1');

    expect(result).toEqual({ available: false, reason: 'AI credential keys must be 32 bytes.' });
  });

  it('parses comma-separated extension IDs from the unified env var', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id,secondary-extension-id',
    });

    expect(config.allowedExtensionIds).toEqual(['primary-extension-id', 'secondary-extension-id']);
    expect(config.allowedOrigins).toContain('chrome-extension://secondary-extension-id');
  });

  it('normalizes quoted extension IDs from Vercel env values', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: '"primary-extension-id,secondary-extension-id"',
    });

    expect(config.allowedExtensionIds).toEqual(['primary-extension-id', 'secondary-extension-id']);
    expect(config.allowedOrigins).toContain('chrome-extension://secondary-extension-id');
  });

  it('normalizes full chrome-extension origins in ALLOWED_EXTENSION_IDS', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS:
        'chrome-extension://primary-extension-id, chrome-extension://secondary-extension-id',
    });

    expect(config.allowedExtensionIds).toEqual(['primary-extension-id', 'secondary-extension-id']);
  });

  it('parses developer emails as a normalized allowlist', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
      DEVELOPER_EMAILS: 'Dev@Example.com, another@example.com ',
    });

    expect(config.developerEmails).toEqual(['dev@example.com', 'another@example.com']);
  });

  it('uses the current recurring Paddle prices as safe fallbacks', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
      PADDLE_PRO_YEARLY_PRICE_ID: undefined,
    });

    expect(config.pricing).toEqual({ monthlyFallback: 1.5, yearlyFallback: 11.9 });
    expect(config.paddle.priceIds.proYearly).toBe('pri_01kcgrnr8xgqcn596h9cx87hh3');
  });

  it('uses the current yearly Paddle catalog price by default', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
    });

    expect(config.paddle.priceIds.proYearly).toBe('pri_01kcgrnr8xgqcn596h9cx87hh3');
  });

  it('does not inherit the official Paddle catalog in self-hosted mode', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'own-extension-id',
      SELF_HOSTED: 'true',
    });
    expect(config.commerceEnabled).toBe(false);
    expect(config.paddle.priceIds.proYearly).toBe('');
  });

  it('rejects example JWT secrets in a production self-hosted deployment', async () => {
    const { validateConfig } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'own-extension-id',
      SELF_HOSTED: 'true',
      NODE_ENV: 'production',
      JWT_SECRET: 'replace-with-a-random-secret',
    });
    expect(() => validateConfig()).toThrow('unique JWT_SECRET');
  });

  it('rejects the retired singular variable', async () => {
    const { config, validateConfig } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_ID: 'legacy-extension-id',
    });

    expect(config.allowedExtensionIds).toEqual([]);
    expect(() => validateConfig()).toThrow('ALLOWED_EXTENSION_IDS');
  });

  it('applies an explicit PostgreSQL SSL mode without changing the configured host', async () => {
    const { config } = await loadConfigWithEnv({
      ALLOWED_EXTENSION_IDS: 'primary-extension-id',
      DATABASE_URL: 'postgresql://user:password@db.example.com:5432/bookmarks?connection_limit=20',
      DATABASE_SSLMODE: 'disable',
      DATABASE_CONNECTION_LIMIT: '5',
    });

    const databaseUrl = new URL(config.databaseUrl);
    expect(databaseUrl.hostname).toBe('db.example.com');
    expect(databaseUrl.searchParams.get('connection_limit')).toBe('5');
    expect(databaseUrl.searchParams.get('sslmode')).toBe('disable');
  });

  it('rejects unsupported PostgreSQL SSL modes', async () => {
    await expect(
      loadConfigWithEnv({
        ALLOWED_EXTENSION_IDS: 'primary-extension-id',
        DATABASE_SSLMODE: 'invalid-mode',
      })
    ).rejects.toThrow('DATABASE_SSLMODE must be one of');
  });

  it('rejects invalid PostgreSQL connection limits', async () => {
    await expect(
      loadConfigWithEnv({
        ALLOWED_EXTENSION_IDS: 'primary-extension-id',
        DATABASE_CONNECTION_LIMIT: '0',
      })
    ).rejects.toThrow('DATABASE_CONNECTION_LIMIT must be a positive integer.');
  });
});
