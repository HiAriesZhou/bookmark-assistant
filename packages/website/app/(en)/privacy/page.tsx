import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/PrivacyPage';
import { createPageMetadata } from '@/lib/i18n';
import { getPrivacyCopy } from '@/lib/privacy-copy';

export const metadata: Metadata = createPageMetadata(
  'en',
  'privacy',
  getPrivacyCopy('en').title,
  getPrivacyCopy('en').description
);

export default function Page() {
  return <PrivacyPage locale="en" />;
}
