import { prepareProfileAssets } from '../../scripts/prepare-profile-assets.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const profile = await prepareProfileAssets({
  ...process.env,
  VITE_OAUTH_SERVER_URL: process.env.NEXT_PUBLIC_API_URL || process.env.VITE_OAUTH_SERVER_URL,
});
const copy = JSON.parse(
  readFileSync(resolve('.product', profile.profile, 'marketing-copy.json'), 'utf8')
);
/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: `.next-${profile.profile}`,
  env: {
    NEXT_PUBLIC_BUILD_PROFILE: profile.profile,
    NEXT_PUBLIC_PRODUCT_NAME: profile.brand.name,
    NEXT_PUBLIC_ASSET_PREFIX: profile.publicAssetsPath,
    NEXT_PUBLIC_MARKETING_COPY: JSON.stringify(copy),
    NEXT_PUBLIC_SITE_URL: profile.official
      ? profile.websiteUrl
      : process.env.NEXT_PUBLIC_SITE_URL || profile.websiteUrl,
    NEXT_PUBLIC_API_URL: profile.apiUrl,
    NEXT_PUBLIC_COMMERCE_ENABLED: String(profile.official),
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
  async rewrites() {
    return [
      ...(profile.official
        ? [
            {
              source: '/apple-developer-merchantid-domain-association',
              destination: `${profile.publicAssetsPath}/apple-developer-merchantid-domain-association`,
            },
          ]
        : []),
      {
        source: '/api/:path*',
        destination: process.env.API_URL
          ? `${process.env.API_URL}/api/:path*`
          : 'http://localhost:3333/api/:path*',
      },
    ];
  },
};

export default nextConfig;
