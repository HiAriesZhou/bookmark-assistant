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
      VITE_GOOGLE_CLIENT_ID: OFFICIAL_SERVICE.googleClientId,
      VITE_PRIVACY_URL: OFFICIAL_SERVICE.privacyUrl,
      VITE_SOURCE_URL: OFFICIAL_SERVICE.sourceUrl,
    });
  });
  it('lets other builds publish their own source and defaults to the upstream repository', () => {
    const own = resolveBuildConfig({
      VITE_OAUTH_SERVER_URL: 'https://self-hosted.example',
      VITE_SOURCE_URL: 'https://git.example/fork',
    });
    expect(own.publicEnv.VITE_SOURCE_URL).toBe('https://git.example/fork');
    expect(resolveBuildConfig({}, { development: true }).publicEnv.VITE_SOURCE_URL).toBe(
      OFFICIAL_SERVICE.sourceUrl
    );
    expect(
      resolveBuildConfig({ VITE_SOURCE_URL: 'https://git.example/fork' }).publicEnv.VITE_SOURCE_URL
    ).toBe(OFFICIAL_SERVICE.sourceUrl);
  });
  it('pins official links and the official Notion client ID for the official service', () => {
    const config = resolveBuildConfig({
      VITE_NOTION_CLIENT_ID: 'other-client',
      VITE_GOOGLE_CLIENT_ID: 'other-google-client',
      VITE_WEBSITE_URL: 'https://self.example',
      VITE_FAQ_URL: 'https://self.example/faq',
      VITE_PRIVACY_URL: 'https://self.example/privacy',
      VITE_TERMS_URL: 'https://self.example/terms',
      VITE_SUPPORT_URL: 'mailto:self@example.com',
    });
    expect(config.officialService).toBe(true);
    expect(config.websiteUrl).toBe(OFFICIAL_SERVICE.websiteUrl);
    expect(config.publicEnv).toMatchObject({
      VITE_NOTION_CLIENT_ID: OFFICIAL_SERVICE.notionClientId,
      VITE_GOOGLE_CLIENT_ID: OFFICIAL_SERVICE.googleClientId,
      VITE_WEBSITE_URL: OFFICIAL_SERVICE.websiteUrl,
      VITE_FAQ_URL: OFFICIAL_SERVICE.faqUrl,
      VITE_PRIVACY_URL: OFFICIAL_SERVICE.privacyUrl,
      VITE_TERMS_URL: OFFICIAL_SERVICE.termsUrl,
      VITE_SUPPORT_URL: OFFICIAL_SERVICE.supportUrl,
    });
  });
  it('defaults development builds to a local server without official links', () => {
    const config = resolveBuildConfig({}, { development: true });
    expect(config.apiUrl).toBe('http://localhost:3333');
    expect(config.officialService).toBe(false);
    expect(config.publicEnv.VITE_NOTION_CLIENT_ID).toBe('');
    expect(config.publicEnv.VITE_GOOGLE_CLIENT_ID).toBe('');
    expect(config.publicEnv.VITE_PRIVACY_URL).toBe('');
  });
  it('lets a self-hosted build select its own HTTPS server and credentials', () => {
    const config = resolveBuildConfig({
      VITE_OAUTH_SERVER_URL: 'https://self-hosted.example',
      VITE_NOTION_CLIENT_ID: 'own-client',
      VITE_GOOGLE_CLIENT_ID: 'own-google-client',
    });
    expect(config.apiUrl).toBe('https://self-hosted.example');
    expect(config.officialService).toBe(false);
    expect(config.publicEnv.VITE_NOTION_CLIENT_ID).toBe('own-client');
    expect(config.publicEnv.VITE_GOOGLE_CLIENT_ID).toBe('own-google-client');
    expect(config.publicEnv.VITE_SUPPORT_URL).toBe('');
    expect(
      resolveBuildConfig({
        VITE_OAUTH_SERVER_URL: 'https://self-hosted.example',
        VITE_WEBSITE_URL: 'https://site.self-hosted.example',
        VITE_PRIVACY_URL: 'https://site.self-hosted.example/privacy',
      }).publicEnv
    ).toMatchObject({
      VITE_WEBSITE_URL: 'https://site.self-hosted.example',
      VITE_PRIVACY_URL: 'https://site.self-hosted.example/privacy',
    });
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
