import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validatePublishDirectory } from './build-zip.js';

const tempDirectories = [];

function createPublishDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-assistant-artifact-'));
  tempDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(directory, '_locales', 'en'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      version: '1.3.1',
      default_locale: 'en',
      background: { service_worker: 'assets/background.js' },
      action: { default_popup: 'popup.html', default_icon: { 16: 'assets/icon-16.png' } },
      options_page: 'options.html',
      icons: { 16: 'assets/icon-16.png' },
    })
  );
  for (const file of [
    'assets/background.js',
    'assets/icon-16.png',
    'popup.html',
    'options.html',
    '_locales/en/messages.json',
  ]) {
    fs.writeFileSync(path.join(directory, file), 'fixture');
  }
  return directory;
}

afterEach(() => {
  while (tempDirectories.length) fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
});

describe('Chrome Web Store artifact validation', () => {
  it('accepts a complete MV3 artifact', () => {
    const result = validatePublishDirectory(createPublishDirectory());
    expect(result.manifest.version).toBe('1.3.1');
    expect(result.files).toContain('assets/background.js');
  });

  it('rejects a manifest whose declared service worker is missing', () => {
    const directory = createPublishDirectory();
    fs.rmSync(path.join(directory, 'assets/background.js'));
    expect(() => validatePublishDirectory(directory)).toThrow('background service worker');
  });

  it('rejects source maps and environment files', () => {
    const directory = createPublishDirectory();
    fs.writeFileSync(path.join(directory, 'assets/background.js.map'), 'fixture');
    expect(() => validatePublishDirectory(directory)).toThrow('forbidden files');
  });

  it('rejects retired or insecure production origins', () => {
    const directory = createPublishDirectory();
    fs.writeFileSync(
      path.join(directory, 'options.html'),
      'https://bookmark-assistant.vercel.app/#faq'
    );
    expect(() => validatePublishDirectory(directory)).toThrow('retired website origin');

    fs.writeFileSync(
      path.join(directory, 'options.html'),
      'http://bookmark-assistant-server.vercel.app'
    );
    expect(() => validatePublishDirectory(directory)).toThrow('insecure production API origin');
  });
});
