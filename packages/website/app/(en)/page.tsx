import type { Metadata } from 'next';
import { LandingPage } from '@/components/LandingPage';
import { createPageMetadata } from '@/lib/i18n';

export const metadata: Metadata = createPageMetadata('en', 'home');

export default function Page() {
  return <LandingPage locale="en" />;
}
