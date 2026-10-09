import '../globals.css';
import type { Metadata } from 'next';
import { ASSET_PREFIX } from '@/lib/product-links';

export const metadata: Metadata = {
  icons: {
    icon: [
      {
        url: `${ASSET_PREFIX}/brand/favicon/favicon.ico`,
        sizes: '16x16 32x32 48x48',
        type: 'image/x-icon',
      },
      { url: `${ASSET_PREFIX}/brand/favicon/favicon-16x16.png`, sizes: '16x16', type: 'image/png' },
      { url: `${ASSET_PREFIX}/brand/favicon/favicon-32x32.png`, sizes: '32x32', type: 'image/png' },
      { url: `${ASSET_PREFIX}/brand/favicon/favicon-48x48.png`, sizes: '48x48', type: 'image/png' },
    ],
    apple: [{ url: `${ASSET_PREFIX}/brand/favicon/apple-touch-icon.png` }],
  },
  manifest: `${ASSET_PREFIX}/brand/favicon/site.webmanifest`,
};

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
