// ⚙️ Server Configuration and Environment Setup

import dotenv from 'dotenv';
import path from 'path';

// Capture the runtime-selected environment before local dotenv files are loaded.
// A developer's `.env.local` must not downgrade an explicit production process.
const environment = process.env.NODE_ENV || 'development';

// Load environment variables in order:
// 1. .env (base configuration)
// 2. .env.local (shared local overrides)
// 3. .env.<NODE_ENV>.local (environment-specific local overrides)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
if (environment !== 'development') {
  dotenv.config({
    path: path.resolve(process.cwd(), `.env.${environment}.local`),
    override: true,
  });
}

const selfHosted = process.env.SELF_HOSTED === 'true';

function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL || '';
  const sslMode = process.env.DATABASE_SSLMODE?.trim();
  const connectionLimit = process.env.DATABASE_CONNECTION_LIMIT?.trim();

  if (!databaseUrl || (!sslMode && !connectionLimit)) return databaseUrl;

  const supportedSslModes = new Set([
    'disable',
    'require',
    'verify-ca',
    'verify-full',
    'no-verify',
  ]);
  if (sslMode && !supportedSslModes.has(sslMode)) {
    throw new Error(
      'DATABASE_SSLMODE must be one of: disable, require, verify-ca, verify-full, no-verify.'
    );
  }

  if (connectionLimit && (!/^\d+$/.test(connectionLimit) || Number(connectionLimit) < 1)) {
    throw new Error('DATABASE_CONNECTION_LIMIT must be a positive integer.');
  }

  try {
    const parsed = new URL(databaseUrl);
    if (sslMode) parsed.searchParams.set('sslmode', sslMode);
    if (connectionLimit) parsed.searchParams.set('connection_limit', connectionLimit);
    return parsed.toString();
  } catch {
    throw new Error('DATABASE_URL must be a valid URL when DATABASE_SSLMODE is set.');
  }
}

function parseCsv(value?: string): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) || []
  );
}

function normalizeExtensionId(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^chrome-extension:\/\//, '');
}

const allowedExtensionIds = Array.from(
  new Set(parseCsv(process.env.ALLOWED_EXTENSION_IDS).map(normalizeExtensionId).filter(Boolean))
);

const developerEmails = Array.from(
  new Set(parseCsv(process.env.DEVELOPER_EMAILS).map((email) => email.toLowerCase()))
);

export type AiCredentialEncryptionConfig =
  | {
      available: true;
      activeKeyVersion: number;
      keys: ReadonlyMap<number, Buffer>;
    }
  | {
      available: false;
      reason: string;
    };

/**
 * Parses a versioned AES-256 keyring without ever logging its contents.
 * The environment format is: `1:base64url-key,2:base64url-key`.
 */
export function parseAiCredentialEncryptionConfig(
  rawKeyring = process.env.AI_CREDENTIAL_ENCRYPTION_KEYS,
  rawActiveVersion = process.env.AI_CREDENTIAL_ACTIVE_KEY_VERSION
): AiCredentialEncryptionConfig {
  if (!rawKeyring?.trim()) {
    return { available: false, reason: 'AI credential encryption keys are not configured.' };
  }

  const keyring = new Map<number, Buffer>();
  for (const entry of rawKeyring
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0 || separator === entry.length - 1) {
      return { available: false, reason: 'AI credential keyring has an invalid entry.' };
    }

    const version = Number(entry.slice(0, separator));
    const encodedKey = entry.slice(separator + 1);
    if (!Number.isInteger(version) || version <= 0 || keyring.has(version)) {
      return { available: false, reason: 'AI credential keyring has an invalid version.' };
    }

    try {
      const key = Buffer.from(encodedKey, 'base64url');
      if (key.length !== 32) {
        return { available: false, reason: 'AI credential keys must be 32 bytes.' };
      }
      keyring.set(version, key);
    } catch {
      return { available: false, reason: 'AI credential keyring contains invalid encoding.' };
    }
  }

  const activeKeyVersion = Number(rawActiveVersion);
  if (!Number.isInteger(activeKeyVersion) || !keyring.has(activeKeyVersion)) {
    return { available: false, reason: 'AI credential active key version is not configured.' };
  }

  return { available: true, activeKeyVersion, keys: keyring };
}

const aiCredentialEncryption = parseAiCredentialEncryptionConfig();

export const config = {
  // Server Configuration
  port: process.env.PORT || 3333,
  nodeEnv: environment,
  // Debug mode for verbose logging
  debug: process.env.DEBUG === 'true',

  // Logging Configuration
  logDir: process.env.LOG_DIR || '/tmp',
  logMaxSize: Number(process.env.LOG_MAX_SIZE) || 5 * 1024 * 1024,
  logMaxFiles: Number(process.env.LOG_MAX_FILES) || 3,
  // Product edition. Self-hosted deployments use local entitlement defaults and do not require Paddle.
  edition: process.env.EDITION || (selfHosted ? 'self-hosted' : 'cloud'),
  selfHosted,

  // Database Configuration
  databaseUrl: resolveDatabaseUrl(),

  // Security Configuration
  jwtSecret: process.env.JWT_SECRET!,
  allowedExtensionId: allowedExtensionIds[0] || '',
  allowedExtensionIds,
  developerEmails,
  aiCredentialEncryption,

  // Notion API Configuration
  notionClientId: process.env.NOTION_CLIENT_ID!,
  notionClientSecret: process.env.NOTION_CLIENT_SECRET!,
  // Upgrade to new Notion API release; allow env override for safe rollout
  notionApiVersion: process.env.NOTION_API_VERSION || '2025-09-03',

  // Rate Limiting Configuration
  rateLimits: {
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 requests per window
    },
    api: {
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 requests per window
    },
  },

  // Website Configuration
  // Support multiple domains: comma-separated URLs or single URL
  websiteUrl: process.env.WEBSITE_URL?.split(',')[0] || 'http://localhost:3006',

  // CORS Configuration
  // Parse WEBSITE_URL (comma-separated) into array for CORS origins
  // Automatically includes both www and non-www variants
  allowedOrigins: (() => {
    const origins = [
      ...allowedExtensionIds.map((extensionId) => `chrome-extension://${extensionId}`),
      'http://localhost:3001', // Alternative Next.js port
    ];

    // Add website URLs (both www and non-www variants)
    const websiteUrls = process.env.WEBSITE_URL?.split(',').map((url) => url.trim()) || [];
    for (const url of websiteUrls) {
      origins.push(url);
      // Add www variant if not already present
      if (url.startsWith('https://') && !url.includes('www.')) {
        origins.push(url.replace('https://', 'https://www.'));
      } else if (url.startsWith('http://') && !url.includes('www.')) {
        origins.push(url.replace('http://', 'http://www.'));
      }
    }

    return origins;
  })(),

  // Session Configuration
  session: {
    expiryHours: 24,
    cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
  },

  // Batch Processing Configuration
  batchDefaults: {
    size: 3,
    delayMs: 334, // ~3 requests per second
  },

  // Description Extraction Configuration
  descriptionExtraction: {
    // Batch size for concurrent description extractions
    // Smaller batches prevent connection pool exhaustion
    batchSize: Number(process.env.DESCRIPTION_EXTRACTION_BATCH_SIZE) || 5,
    // Delay between batches (ms)
    batchDelayMs: Number(process.env.DESCRIPTION_EXTRACTION_BATCH_DELAY) || 100,
    // Timeout for individual extraction (ms)
    timeoutMs: Number(process.env.DESCRIPTION_EXTRACTION_TIMEOUT) || 5000,
  },

  // Reserve wall time for the required Notion writes and response. Description
  // extraction is optional and yields before this serverless budget is exhausted.
  syncTimeBudget: {
    requestMs: Number(process.env.SYNC_REQUEST_BUDGET_MS) || 240_000,
    descriptionMs: Number(process.env.SYNC_DESCRIPTION_BUDGET_MS) || 180_000,
    reserveForBaseSyncMs: Number(process.env.SYNC_BASE_SYNC_RESERVE_MS) || 60_000,
  },

  pricing: {
    monthlyFallback: 1.5, // USD per month - fallback only
    yearlyFallback: 11.9, // USD per year - fallback only
  },

  limits: {
    free: {
      minIntervalHours: Number(process.env.FREE_INTERVAL_HOURS) || 24,
    },
    pro: {
      minIntervalHours: Number(process.env.PRO_INTERVAL_HOURS) || 6,
    },
  },

  // Paddle Payment Configuration
  paddle: {
    apiKey: process.env.PADDLE_API_KEY || '',
    environment: process.env.PADDLE_ENVIRONMENT || 'sandbox',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
    priceIds: {
      proMonthly: process.env.PADDLE_PRO_MONTHLY_PRICE_ID || '',
      proYearly:
        process.env.PADDLE_PRO_YEARLY_PRICE_ID ||
        (selfHosted ? '' : 'pri_01kcgrnr8xgqcn596h9cx87hh3'),
    },
  },

  commerceEnabled: !selfHosted && !!process.env.PADDLE_API_KEY,
} as const;

// Validation function to ensure required environment variables are set
export function validateConfig(): void {
  const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'];

  const missing = requiredVars.filter((varName) => !process.env[varName]);
  if (allowedExtensionIds.length === 0) {
    missing.push('ALLOWED_EXTENSION_IDS');
  }

  // Paddle is optional for development but required for production
  // Monthly and yearly are the only plans currently available for purchase.
  const paddleConfig = [
    ['PADDLE_API_KEY', config.paddle.apiKey],
    ['PADDLE_WEBHOOK_SECRET', config.paddle.webhookSecret],
    ['PADDLE_PRO_MONTHLY_PRICE_ID', config.paddle.priceIds.proMonthly],
    ['PADDLE_PRO_YEARLY_PRICE_ID', config.paddle.priceIds.proYearly],
  ] as const;

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Please check your .env file and environment configuration.`
    );
  }

  if (
    config.selfHosted &&
    config.nodeEnv === 'production' &&
    (Buffer.byteLength(config.jwtSecret || '') < 32 ||
      /^(?:replace-|your-)/i.test(config.jwtSecret))
  ) {
    throw new Error('Self-hosted production requires a unique JWT_SECRET of at least 32 bytes.');
  }

  // Warn if Paddle vars are missing in production cloud mode.
  // Self-hosted deployments intentionally run without Paddle.
  if (process.env.NODE_ENV === 'production' && !config.selfHosted) {
    const missingPaddle = paddleConfig.filter(([, value]) => !value).map(([name]) => name);
    if (missingPaddle.length > 0) {
      console.warn(
        `⚠️  Missing Paddle environment variables: ${missingPaddle.join(', ')}. Payment features will be disabled.`
      );
    }
  }

  console.log('✅ Configuration validated successfully');
}

export default config;
