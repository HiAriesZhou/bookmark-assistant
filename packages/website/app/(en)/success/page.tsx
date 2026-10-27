import type { Metadata } from 'next';
import { CheckCircle, ExternalLink } from 'lucide-react';
import {
  CHROME_WEB_STORE_URL,
  SITE_URL,
  PRODUCT_NAME,
  COMMERCE_ENABLED,
} from '@/lib/product-links';
import { STANDALONE_BODY, STANDALONE_PRIMARY, StandalonePage } from '@/components/StandalonePage';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: COMMERCE_ENABLED ? `Subscription updated · ${PRODUCT_NAME}` : PRODUCT_NAME,
  description: COMMERCE_ENABLED
    ? `Your ${PRODUCT_NAME} subscription checkout has completed.`
    : 'Self-hosted bookmark management.',
  alternates: { canonical: '/success' },
  robots: { index: false, follow: false },
};

export default function SuccessPage() {
  return (
    <StandalonePage
      icon={<CheckCircle className="h-8 w-8" aria-hidden="true" />}
      eyebrow={COMMERCE_ENABLED ? 'Checkout complete' : 'GPL-3.0-only'}
      title={`Return to ${PRODUCT_NAME}`}
    >
      <p className={STANDALONE_BODY}>
        {COMMERCE_ENABLED
          ? 'Go back to the Bookmark Assistant settings tab. It switches to Pro on its own once Paddle confirms the payment. If you closed it, reopen Settings and press refresh next to Account.'
          : 'Self-hosted deployments include all features. Open your local bookmark library to continue.'}
      </p>
      <a
        href={COMMERCE_ENABLED ? CHROME_WEB_STORE_URL : '/'}
        target="_blank"
        rel="noreferrer"
        className={`mt-8 ${STANDALONE_PRIMARY}`}
      >
        {COMMERCE_ENABLED ? 'Open Chrome Web Store' : 'Return home'}
        <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
      </a>
    </StandalonePage>
  );
}
