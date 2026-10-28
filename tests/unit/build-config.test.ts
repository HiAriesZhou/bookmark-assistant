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
      VITE_PRIVACY_URL: OFFICIAL_SERVICE.privacyUrl,
      VITE_SOURCE_URL: OFFICIAL_SERVICE.sourceUrl,
    });
  });
  it('ships no server origin or OAuth client in the extension build', () => {
    expect(Object.keys(resolveBuildConfig({}).publicEnv).sort()).toEqual([
      'VITE_APP_NAME',
      'VITE_FAQ_URL',
      'VITE_PRIVACY_URL',
      'VITE_SOURCE_URL',
      'VITE_TERMS_URL',
    ]);
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
  it('pins official links for the official build', () => {
    const config = resolveBuildConfig({
      VITE_WEBSITE_URL: 'https://self.example',
      VITE_FAQ_URL: 'https://self.example/faq',
      VITE_PRIVACY_URL: 'https://self.example/privacy',
      VITE_TERMS_URL: 'https://self.example/terms',
      VITE_SUPPORT_URL: 'mailto:self@example.com',
    });
    expect(config.officialService).toBe(true);
    expect(config.websiteUrl).toBe(OFFICIAL_SERVICE.websiteUrl);
    expect(config.publicEnv).toMatchObject({
      VITE_FAQ_URL: OFFICIAL_SERVICE.faqUrl,
      VITE_PRIVACY_URL: OFFICIAL_SERVICE.privacyUrl,
      VITE_TERMS_URL: OFFICIAL_SERVICE.termsUrl,
    });
  });
  it('defaults development builds to a local server without official links', () => {
    const config = resolveBuildConfig({}, { development: true });
    expect(config.apiUrl).toBe('http://localhost:3333');
    expect(config.officialService).toBe(false);
    expect(config.publicEnv.VITE_PRIVACY_URL).toBe('');
  });
  it('lets another build set its own links', () => {
    const config = resolveBuildConfig({
      VITE_OAUTH_SERVER_URL: 'https://self-hosted.example',
      VITE_WEBSITE_URL: 'https://site.self-hosted.example',
      VITE_PRIVACY_URL: 'https://site.self-hosted.example/privacy',
    });
    expect(config.officialService).toBe(false);
    expect(config.websiteUrl).toBe('https://site.self-hosted.example');
    expect(config.publicEnv.VITE_PRIVACY_URL).toBe('https://site.self-hosted.example/privacy');
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
