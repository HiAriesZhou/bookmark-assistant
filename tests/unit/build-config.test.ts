import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared build tooling is ESM.
import { OFFICIAL_LINKS, resolveBuildConfig } from '../../scripts/build-config.mjs';

describe('build configuration', () => {
  it('builds the official product by default', () => {
    const config = resolveBuildConfig({});
    expect(config.brand.name).toBe('Bookmark Assistant');
    expect(config.officialBuild).toBe(true);
    expect(config.websiteUrl).toBe(OFFICIAL_LINKS.websiteUrl);
    expect(config.publicEnv).toMatchObject({
      VITE_PRIVACY_URL: OFFICIAL_LINKS.privacyUrl,
      VITE_SOURCE_URL: OFFICIAL_LINKS.sourceUrl,
    });
  });
  it('ships no server origin or OAuth client in the extension build', () => {
    const config = resolveBuildConfig({});
    expect(Object.keys(config.publicEnv).sort()).toEqual([
      'VITE_APP_NAME',
      'VITE_FAQ_URL',
      'VITE_PRIVACY_URL',
      'VITE_SOURCE_URL',
      'VITE_TERMS_URL',
    ]);
    expect(config).not.toHaveProperty('apiUrl');
  });
  it('stays official when VITE_WEBSITE_URL names the official site and pins official links', () => {
    const config = resolveBuildConfig({
      VITE_WEBSITE_URL: `${OFFICIAL_LINKS.websiteUrl}/`,
      VITE_FAQ_URL: 'https://self.example/faq',
      VITE_PRIVACY_URL: 'https://self.example/privacy',
      VITE_TERMS_URL: 'https://self.example/terms',
      VITE_SOURCE_URL: 'https://git.example/fork',
    });
    expect(config.officialBuild).toBe(true);
    expect(config.websiteUrl).toBe(OFFICIAL_LINKS.websiteUrl);
    expect(config.publicEnv).toMatchObject({
      VITE_FAQ_URL: OFFICIAL_LINKS.faqUrl,
      VITE_PRIVACY_URL: OFFICIAL_LINKS.privacyUrl,
      VITE_TERMS_URL: OFFICIAL_LINKS.termsUrl,
      VITE_SOURCE_URL: OFFICIAL_LINKS.sourceUrl,
    });
  });
  it('treats development builds as unofficial without official links', () => {
    const config = resolveBuildConfig({}, { development: true });
    expect(config.officialBuild).toBe(false);
    expect(config.websiteUrl).toBe('http://localhost:3001');
    expect(config.publicEnv.VITE_PRIVACY_URL).toBe('');
    expect(config.publicEnv.VITE_SOURCE_URL).toBe(OFFICIAL_LINKS.sourceUrl);
  });
  it('treats a build for another site as unofficial and uses its own links', () => {
    const config = resolveBuildConfig({
      VITE_WEBSITE_URL: 'https://site.fork.example',
      VITE_PRIVACY_URL: 'https://site.fork.example/privacy',
      VITE_SOURCE_URL: 'https://git.example/fork',
    });
    expect(config.officialBuild).toBe(false);
    expect(config.websiteUrl).toBe('https://site.fork.example');
    expect(config.publicEnv).toMatchObject({
      VITE_FAQ_URL: '',
      VITE_PRIVACY_URL: 'https://site.fork.example/privacy',
      VITE_SOURCE_URL: 'https://git.example/fork',
    });
  });
  it.each(['not a url', 'file:///tmp/site', 'https://name:secret@example.com'])(
    'rejects an unusable website URL: %s',
    (url) => {
      expect(() => resolveBuildConfig({ VITE_WEBSITE_URL: url })).toThrow();
    }
  );
});
