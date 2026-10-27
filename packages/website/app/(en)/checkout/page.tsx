import type { Metadata } from 'next';
import { PaddleCheckout } from '@/components/PaddleCheckout';
import { PRODUCT_NAME, SITE_URL } from '@/lib/product-links';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `Checkout · ${PRODUCT_NAME}`,
  alternates: { canonical: '/checkout' },
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <PaddleCheckout />;
}
