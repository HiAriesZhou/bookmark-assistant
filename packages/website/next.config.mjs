import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import { prepareBrandAssets } from '../../scripts/prepare-brand-assets.mjs';

/** @type {(phase: string) => Promise<import('next').NextConfig>} */
export default async function nextConfig(phase) {
  // VITE_WEBSITE_URL decides whether this is the official build, as for the extension.
  const config = await prepareBrandAssets(process.env, {
    development: phase === PHASE_DEVELOPMENT_SERVER,
  });
  return {
    env: {
      NEXT_PUBLIC_OFFICIAL_BUILD: String(config.officialBuild),
      NEXT_PUBLIC_PRODUCT_NAME: config.brand.name,
      NEXT_PUBLIC_ASSET_PREFIX: config.publicAssetsPath,
      // The official site keeps its canonical URL; other deployments may set their own.
      NEXT_PUBLIC_SITE_URL: config.officialBuild
        ? config.websiteUrl
        : process.env.NEXT_PUBLIC_SITE_URL || config.websiteUrl,
    },
    reactStrictMode: true,
    images: {
      remotePatterns: [
        {
          protocol: 'https',
          hostname: 'images.unsplash.com',
        },
      ],
    },
    // The extension no longer uses a server. This rewrite serves only extension
    // versions released before the client-only version until the legacy server shuts down.
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: process.env.API_URL
            ? `${process.env.API_URL}/api/:path*`
            : 'http://localhost:3333/api/:path*',
        },
      ];
    },
  };
}
