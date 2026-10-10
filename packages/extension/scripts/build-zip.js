#!/usr/bin/env node
/**
 * Chrome Extension Build & Zip Script
 * Automatically builds extension and creates a publish-ready zip file
 *
 * This script:
 * Builds the production extension for the configured service and packages its validated output.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveBuildConfig } from '../../../scripts/build-config.mjs';
const buildConfig = resolveBuildConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const buildDir = path.join(projectRoot, 'build');
const FORBIDDEN_ARTIFACT_NAMES = new Set([
  '.env',
  '.env.local',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.git',
  'node_modules',
]);
const FORBIDDEN_RELEASE_TEXT = [
  {
    pattern: /https:\/\/bookmark-assistant\.vercel\.app/,
    label: 'retired website origin',
  },
  {
    pattern: /http:\/\/bookmark-assistant-server\.vercel\.app/,
    label: 'insecure production API origin',
  },
];

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function logStep(step, message) {
  console.log(`\n${COLORS.cyan}[${step}]${COLORS.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${COLORS.green}✓ ${message}${COLORS.reset}`);
}

function logWarning(message) {
  console.log(`${COLORS.yellow}⚠ ${message}${COLORS.reset}`);
}

function logError(message) {
  console.log(`${COLORS.red}✗ ${message}${COLORS.reset}`);
}

async function cleanup() {
  logStep('Cleanup', 'Removing temporary files...');
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

async function buildExtension() {
  logStep('Build', 'Building extension for production...');
  try {
    execSync('npm run build:prod', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    logSuccess('Extension built successfully');
  } catch (error) {
    logError('Build failed');
    throw error;
  }
}

export function listArtifactFiles(rootDir, relativePath = '') {
  return fs
    .readdirSync(path.join(rootDir, relativePath), { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) return listArtifactFiles(rootDir, entryPath);
      return [entryPath];
    });
}

function assertArtifactFileExists(rootDir, relativePath, label) {
  if (!fs.existsSync(path.join(rootDir, relativePath))) {
    throw new Error(`Publish artifact is missing ${label}: ${relativePath}`);
  }
}

/** Validates the complete unpacked Chrome Web Store payload before zipping it. */
export function validatePublishDirectory(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Publish artifact is missing manifest.json. Build may have failed.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error('Publish artifact must use manifest_version 3.');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Publish artifact has an invalid manifest version.');
  }
  if (typeof manifest.background?.service_worker !== 'string') {
    throw new Error('Publish artifact must declare a background service worker.');
  }

  assertArtifactFileExists(
    directory,
    manifest.background.service_worker,
    'background service worker'
  );
  if (typeof manifest.action?.default_popup === 'string') {
    assertArtifactFileExists(directory, manifest.action.default_popup, 'popup');
  }
  if (typeof manifest.options_page === 'string') {
    assertArtifactFileExists(directory, manifest.options_page, 'options page');
  }
  if (typeof manifest.default_locale === 'string') {
    assertArtifactFileExists(
      directory,
      path.join('_locales', manifest.default_locale, 'messages.json'),
      'default-locale messages'
    );
  }

  const iconPaths = new Set([
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ]);
  for (const iconPath of iconPaths) {
    if (typeof iconPath === 'string') assertArtifactFileExists(directory, iconPath, 'icon');
  }

  const files = listArtifactFiles(directory);
  const forbidden = files.filter((file) => {
    const segments = file.split(path.sep);
    return (
      segments.some(
        (segment) => FORBIDDEN_ARTIFACT_NAMES.has(segment) || /^\.env(?:\.|$)/.test(segment)
      ) ||
      file.endsWith('.map') ||
      file.endsWith('.log')
    );
  });
  if (forbidden.length) {
    throw new Error(`Publish artifact includes forbidden files: ${forbidden.join(', ')}`);
  }

  const textFiles = files.filter((file) => /\.(?:html|js|json)$/.test(file));
  const forbiddenText = textFiles.flatMap((file) => {
    const content = fs.readFileSync(path.join(directory, file), 'utf8');
    return FORBIDDEN_RELEASE_TEXT.filter(({ pattern }) => pattern.test(content)).map(
      ({ label }) => `${file} (${label})`
    );
  });
  if (forbiddenText.length) {
    throw new Error(
      `Publish artifact includes forbidden release text: ${forbiddenText.join(', ')}`
    );
  }

  return { manifest, files: files.sort() };
}

function copyPublishDirectory(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (
      FORBIDDEN_ARTIFACT_NAMES.has(entry.name) ||
      entry.name.endsWith('.map') ||
      entry.name.endsWith('.log')
    ) {
      continue;
    }
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyPublishDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

async function createPublishZip() {
  const { manifest } = validatePublishDirectory(distPath);
  const version = manifest.version;
  const zipName = buildConfig.officialService
    ? `bookmark-assistant-v${version}.zip`
    : `bookmark-assistant-self-hosted-v${version}.zip`;
  const zipPath = path.join(projectRoot, zipName);

  logStep('Archive', `Creating ${zipName}...`);

  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  // Copy the complete, validated build output. The manifest determines runtime
  // entry points, so silently skipping a file would create a broken store zip.
  fs.mkdirSync(buildDir, { recursive: true });
  copyPublishDirectory(distPath, buildDir);
  validatePublishDirectory(buildDir);

  // Create zip using zip command (macOS/Linux)
  try {
    execSync(`cd "${buildDir}" && zip -r "${zipPath}" . -x "*.DS_Store" "*.git*"`, {
      stdio: 'inherit',
    });
  } catch (error) {
    // If zip command not available, try using node's native capabilities
    logWarning('System zip command not available, using alternative method...');
    await createZipAlternative(buildDir, zipPath);
  }

  // Clean up build directory
  fs.rmSync(buildDir, { recursive: true, force: true });

  logSuccess(`Created: ${zipName}`);
  return { zipPath, zipName, version };
}

async function createZipAlternative(sourceDir, outputPath) {
  // Fallback method using JSZip
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  function addFilesToZip(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(dir, entry.name);
      const zipPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        addFilesToZip(srcPath, zipPath);
      } else {
        const content = fs.readFileSync(srcPath);
        zip.file(zipPath, content);
      }
    }
  }

  addFilesToZip(sourceDir);

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(outputPath, content);
}

function printSummary({ zipName, version }) {
  console.log('\n' + '='.repeat(60));
  logSuccess('Build Complete!', COLORS.green);
  console.log('='.repeat(60));
  console.log(`\n  Version: ${COLORS.cyan}${version}${COLORS.reset}`);
  console.log(`  Zip file: ${COLORS.green}${zipName}${COLORS.reset}`);
  console.log(`\n${COLORS.yellow}Ready for Chrome Web Store upload!${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Chrome Extension Build & Zip Tool', COLORS.cyan);
  console.log('='.repeat(60) + '\n');

  try {
    // Cleanup on start
    await cleanup();

    // Backup and remove .env.local for production build
    // Production inputs are isolated by build-production.js.

    // Build the extension
    await buildExtension();

    // Create publish-ready zip
    const result = await createPublishZip();

    // Restore .env.local
    // No local environment files are changed.

    // Print summary
    printSummary(result);

    process.exit(0);
  } catch (error) {
    logError(`Build failed: ${error.message}`);
    console.error('\nStack trace:', error.stack);

    // Cleanup on error
    await cleanup();

    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  void main();
}
