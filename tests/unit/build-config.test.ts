import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared build tooling is ESM.
import { OFFICIAL_SERVICE, resolveBuildConfig } from '../../scripts/build-config.mjs';

describe('build configuration', () => {
  it('builds the official product against the official service by default', () => {
    const config = resolveBuildConfig({});
    expect(config.brand.name).toBe('Bookmark Assistant');
    expect(config.apiUrl).toBe(OFFICIAL_SERVICE.apiUrl);
    expect(config.officialService).toBe(true);
    expect(config.publicEnv).toMatchObject({
      VITE_OFFICIAL_SERVICE: 'true',
      VITE_NOTION_CLIENT_ID: OFFICIAL_SERVICE.notionClientId,
      VITE_PRIVACY_URL: OFFICIAL_SERVICE.privacyUrl,
    });
  });
  it('defaults development builds to a local server without official links', () => {
    const config = resolveBuildConfig({}, { development: true });
    expect(config.apiUrl).toBe('http://localhost:3333');
    expect(config.officialService).toBe(false);
    expect(config.publicEnv.VITE_NOTION_CLIENT_ID).toBe('');
    expect(config.publicEnv.VITE_PRIVACY_URL).toBe('');
  });
  it('lets a self-hosted build select its own HTTPS server and credentials', () => {
    const config = resolveBuildConfig({
      VITE_OAUTH_SERVER_URL: 'https://self-hosted.example',
      VITE_NOTION_CLIENT_ID: 'own-client',
    });
    expect(config.apiUrl).toBe('https://self-hosted.example');
    expect(config.officialService).toBe(false);
    expect(config.publicEnv.VITE_NOTION_CLIENT_ID).toBe('own-client');
    expect(config.publicEnv.VITE_SUPPORT_URL).toBe('');
  });
  it('allows self-hosted builds without Notion for local-only use', () => {
    expect(
      resolveBuildConfig({ VITE_OAUTH_SERVER_URL: 'http://localhost:3333' }).publicEnv
        .VITE_NOTION_CLIENT_ID
    ).toBe('');
  });
  it.each([
    'http://public.example',
    'https://name:secret@example.com',
    'https://example.com/?token=secret',
    'file:///tmp/api',
    'https://example.com/api',
  ])('rejects unsafe or ambiguous origins: %s', (url) => {
    expect(() => resolveBuildConfig({ VITE_OAUTH_SERVER_URL: url })).toThrow();
  });
});
