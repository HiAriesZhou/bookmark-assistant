import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared build tooling is ESM.
import { assertReleaseBuildEnv, resolveBuildProfile } from '../../scripts/build-profile.mjs';

describe('build deployment boundaries', () => {
  it('defaults to neutral branding and a local server', () => {
    const profile = resolveBuildProfile({});
    expect(profile.profile).toBe('community');
    expect(profile.brand.name).toBe('Link Library');
    expect(profile.apiUrl).toBe('http://localhost:3333');
    expect(profile.publicEnv.VITE_PRIVACY_URL).toBe('');
  });
  it('accepts an independent HTTPS deployment without an official asset dependency', () => {
    expect(
      resolveBuildProfile({ VITE_OAUTH_SERVER_URL: 'https://self-hosted.example' }).apiUrl
    ).toBe('https://self-hosted.example');
  });
  it.each([
    'http://public.example',
    'https://name:secret@example.com',
    'https://example.com/?token=secret',
    'file:///tmp/api',
    'https://example.com/api',
  ])('rejects unsafe or ambiguous origins: %s', (url) => {
    expect(() => resolveBuildProfile({ VITE_OAUTH_SERVER_URL: url })).toThrow();
  });
  it('does not silently build official branding when the asset workspace is missing', () => {
    expect(() =>
      resolveBuildProfile({
        BOOKMARK_ASSISTANT_BUILD_PROFILE: 'official',
        BOOKMARK_ASSISTANT_OFFICIAL_ASSETS: '/missing-official-assets',
      })
    ).toThrow('Official assets are missing');
  });
  it('refuses to package an official build without a Notion client ID', () => {
    expect(() =>
      assertReleaseBuildEnv({ official: true, publicEnv: { VITE_NOTION_CLIENT_ID: '' } })
    ).toThrow('VITE_NOTION_CLIENT_ID');
    expect(() =>
      assertReleaseBuildEnv({ official: true, publicEnv: { VITE_NOTION_CLIENT_ID: 'client' } })
    ).not.toThrow();
  });
  it('lets asset-only scripts resolve the official profile without a Notion client ID', () => {
    expect(() =>
      resolveBuildProfile({
        BOOKMARK_ASSISTANT_BUILD_PROFILE: 'official',
        BOOKMARK_ASSISTANT_OFFICIAL_ASSETS: '/missing-official-assets',
      })
    ).toThrow('Official assets are missing');
  });
  it('allows community builds without Notion for local-only use', () => {
    expect(resolveBuildProfile({}).publicEnv.VITE_NOTION_CLIENT_ID).toBe('');
  });
});
