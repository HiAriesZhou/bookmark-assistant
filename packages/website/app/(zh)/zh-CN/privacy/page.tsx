import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/PrivacyPage';
import { createPageMetadata } from '@/lib/i18n';
import { getPrivacyCopy } from '@/lib/privacy-copy';

export const metadata: Metadata = createPageMetadata(
  'zh-CN',
  'privacy',
  getPrivacyCopy('zh-CN').title,
  getPrivacyCopy('zh-CN').description
);

export default function Page() {
  return <PrivacyPage locale="zh-CN" />;
}
