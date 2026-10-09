#!/usr/bin/env node
/**
 * i18n Validation Script
 * Checks for:
 * 1. Unused English translation keys (in messages.json but not used in code)
 * 2. Missing translation keys in every supported runtime locale
 * 3. Required manifest localization keys in every runtime locale
 *
 * Usage: node scripts/check-i18n.js
 */

const fs = require('fs');
const path = require('path');

const LOCALES_ROOT = path.join(__dirname, '../packages/extension/_locales');
const RUNTIME_LOCALES = ['en', 'zh_CN'];
const MESSAGES_PATH = path.join(LOCALES_ROOT, 'en/messages.json');
const EXTENSION_SRC = path.join(__dirname, '../packages/extension/src');

// Load messages.json
let messages;
try {
  messages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
} catch (e) {
  console.error('Failed to load messages.json:', e.message);
  process.exit(1);
}

const messageKeys = new Set(Object.keys(messages));
const catalogs = new Map(
  RUNTIME_LOCALES.map((locale) => {
    const file = path.join(LOCALES_ROOT, locale, 'messages.json');
    if (!fs.existsSync(file)) {
      console.error(`Missing runtime locale catalog: ${locale}`);
      process.exit(1);
    }
    return [locale, JSON.parse(fs.readFileSync(file, 'utf8'))];
  })
);
console.log(
  `Found ${messageKeys.size} English keys across ${RUNTIME_LOCALES.length} runtime locales`
);

// Known non-translation patterns to exclude
const KNOWN_STORAGE_KEYS = new Set([
  'auto_sync_enabled',
  'sync_in_progress',
  'error_reports',
  'upgraded',
  'session_token',
  'notion_token',
  'is_pro',
  'user_id',
  'last_sync',
  'code', // URLSearchParams.get('code') - not a translation key
  'key_name', // documentation example in utils/i18n.ts
]);

// Find all translation key usages in source code
// Match patterns: t('key'), t("key")
// Exclude patterns that are not translation keys (storage keys, email templates, etc.)
const translationPattern = /\bt\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g;

const usedKeys = new Set();
const sourceFiles = ['tsx', 'ts', 'jsx', 'js'];

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === 'dist' || file === '.git') {
        continue;
      }
      scanDirectory(fullPath);
    } else {
      const ext = file.split('.').pop();
      // Skip test files for production check
      if (!sourceFiles.includes(ext) || file.includes('.test.') || file.includes('.spec.')) {
        continue;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        let match;
        while ((match = translationPattern.exec(content)) !== null) {
          const key = match[1];
          // Skip single-letter keys, very short keys, and known storage keys
          if (key.length >= 3 && !KNOWN_STORAGE_KEYS.has(key)) {
            usedKeys.add(key);
          }
        }
      } catch (e) {
        // Skip files that can't be read
      }
    }
  }
}

console.log('Scanning source files for translation key usage...');
scanDirectory(EXTENSION_SRC);

console.log(`Found ${usedKeys.size} translation keys used in code`);

// Check for unused keys (in messages.json but not used in code)
const unusedKeys = [...messageKeys].filter((key) => !usedKeys.has(key));

// Check for missing keys in every supported runtime locale. Catalogs may contain
// additional historical strings, but any string used by current UI must be translated.
const missingByLocale = new Map(
  [...catalogs].map(([locale, catalog]) => [
    locale,
    [...usedKeys].filter((key) => !Object.prototype.hasOwnProperty.call(catalog, key)),
  ])
);
const requiredManifestKeys = ['appName', 'appDesc', 'extensionTitle'];

// Report results
console.log('\n--- Results ---');

let hasErrors = false;

if (unusedKeys.length > 0) {
  console.log(`\nUnused translation keys (${unusedKeys.length}):`);
  unusedKeys.slice(0, 20).forEach((key) => console.log(`  - ${key}`));
  if (unusedKeys.length > 20) {
    console.log(`  ... and ${unusedKeys.length - 20} more`);
  }
}

for (const [locale, missingKeys] of missingByLocale) {
  const catalog = catalogs.get(locale);
  const missingManifestKeys = requiredManifestKeys.filter((key) => !catalog[key]?.message);
  if (missingKeys.length || missingManifestKeys.length) {
    console.log(`\nMissing ${locale} translations:`);
    missingKeys.forEach((key) => console.log(`  - ${key}`));
    missingManifestKeys.forEach((key) => console.log(`  - ${key} (manifest)`));
    hasErrors = true;
  }
}

if (unusedKeys.length === 0 && !hasErrors) {
  console.log('\nAll translation keys are in use and defined!');
} else if (!hasErrors) {
  console.log('\nAll used keys have translations in every runtime locale');
}

if (hasErrors) {
  console.log('\ni18n check failed: missing runtime translations');
  process.exit(1);
} else {
  console.log('\ni18n check passed');
  process.exit(0);
}
