import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import { prepareBrandAssets } from '../../scripts/prepare-brand-assets.mjs';
import { checkoutFrameAncestors } from './lib/checkout-frame-ancestors.mjs';

/** @type {(phase: string) => Promise<import('next').NextConfig>} */
export default async function nextConfig(phase) {
  const config = await prepareBrandAssets(
    {
      ...process.env,
      VITE_OAUTH_SERVER_URL: process.env.NEXT_PUBLIC_API_URL || process.env.VITE_OAUTH_SERVER_URL,
    },
    { development: phase === PHASE_DEVELOPMENT_SERVER }
  );
  return {
    env: {
      NEXT_PUBLIC_OFFICIAL_SERVICE: String(config.officialService),
      NEXT_PUBLIC_PRODUCT_NAME: config.brand.name,
      NEXT_PUBLIC_ASSET_PREFIX: config.publicAssetsPath,
      // The official site keeps its canonical URL; other deployments may set their own.
      NEXT_PUBLIC_SITE_URL: config.officialService
        ? config.websiteUrl
        : process.env.NEXT_PUBLIC_SITE_URL || config.websiteUrl,
      NEXT_PUBLIC_API_URL: config.apiUrl,
      NEXT_PUBLIC_COMMERCE_ENABLED:
        process.env.NEXT_PUBLIC_COMMERCE_ENABLED || String(config.officialService),
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
    // Only this site and our extension may frame the checkout page.
    async headers() {
      return [
        {
          source: '/checkout',
          headers: [
            {
              key: 'Content-Security-Policy',
              value: checkoutFrameAncestors({
                extensionIds: process.env.CHECKOUT_EXTENSION_IDS,
                officialService: config.officialService,
              }),
            },
          ],
        },
      ];
    },
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
