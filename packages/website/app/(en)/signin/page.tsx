import type { Metadata } from 'next';
import { SignInGuide } from '@/components/SignInGuide';
import { localePath } from '@/lib/i18n';
import { PRODUCT_NAME, SITE_URL } from '@/lib/product-links';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `Sign in · ${PRODUCT_NAME}`,
  alternates: { canonical: localePath('en', 'signin') },
  robots: { index: false, follow: true },
};

export default function Page() {
  return <SignInGuide locale="en" />;
}
