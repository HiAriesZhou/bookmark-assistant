import { productConfig } from '../product-config';

export interface AppConfig {
  // Notion Integration
  notion: {
    clientId: string;
    serverUrl: string;
  };

  // App Settings
  app: {
    name: string;
    version: string;
    debugMode: boolean;
  };
}

/**
 * Get environment variable with type safety and validation
 */
function getEnvVar(key: string, defaultValue?: string): string {
  const value = import.meta.env[key] || defaultValue;
  if (!value) {
    console.warn(`Environment variable ${key} is not set`);
    return '';
  }
  return value;
}

/**
 * Get environment variable as boolean
 */
function getEnvBoolean(key: string, defaultValue: boolean) {
  const value = import.meta.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Application configuration object
 */
export const config: AppConfig = {
  notion: {
    clientId: getEnvVar('VITE_NOTION_CLIENT_ID', ''),
    serverUrl: productConfig.apiUrl,
  },
  app: {
    name: productConfig.name,
    version: PRODUCT_VERSION,
    debugMode: getEnvBoolean('VITE_DEBUG_MODE', true),
  },
};

/**
 * Validate configuration and log warnings for missing values
 */
export function validateConfig(): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors = Array<string>();
  const warnings = Array<string>();

  if (!config.notion.clientId) {
    errors.push('VITE_NOTION_CLIENT_ID is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Debug helper to log current configuration (excluding sensitive data)
 */
export function debugConfig(): void {
  if (!config.app.debugMode) return;

  console.group('🔧 Extension Configuration');
  console.log('App:', {
    name: config.app.name,
    version: config.app.version,
    debugMode: config.app.debugMode,
  });
  console.log('Notion:', {
    clientId: config.notion.clientId ? '✅ Set' : '❌ Missing',
  });
  console.groupEnd();
}
import { PRODUCT_VERSION } from '../product-version.generated';
