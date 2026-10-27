import type { Metadata } from 'next';
import {
  marketingCopy,
  type WebsiteCopy,
  type WebsiteLocale,
} from '@/lib/marketing-copy.generated';
import { SITE_URL, ASSET_PREFIX } from '@/lib/product-links';

export { type WebsiteCopy, type WebsiteLocale };

export function getWebsiteCopy(locale: WebsiteLocale): WebsiteCopy {
  return marketingCopy[locale] as WebsiteCopy;
}

function includePreparedWebsiteContent(): boolean {
  return process.env.NEXT_PUBLIC_WEBSITE_CHANNEL === 'preview';
}

function isPublished(
  status: 'released' | 'prepared',
  includePrepared = includePreparedWebsiteContent()
): boolean {
  return status === 'released' || includePrepared;
}

export function isAiPublished(copy: WebsiteCopy): boolean {
  return isPublished(copy.publication.ai);
}

export function isWebsiteItemVisible(status: 'released' | 'prepared', copy: WebsiteCopy): boolean {
  return status === 'released' || isAiPublished(copy);
}

export function localePath(locale: WebsiteLocale, page: 'home' | 'privacy' | 'signin'): string {
  const prefix = locale === 'zh-CN' ? '/zh-CN' : '';
  if (page === 'home') return prefix || '/';
  return `${prefix}/${page}`;
}

export function alternateLocale(locale: WebsiteLocale): WebsiteLocale {
  return locale === 'en' ? 'zh-CN' : 'en';
}

export function createPageMetadata(
  locale: WebsiteLocale,
  page: 'home' | 'privacy',
  privacyTitle?: string,
  privacyDescription?: string
): Metadata {
  const copy = getWebsiteCopy(locale);
  const aiVisible = isAiPublished(copy);
  const title =
    page === 'privacy'
      ? privacyTitle || `Privacy Policy · ${copy.productName}`
      : aiVisible
        ? copy.metadata.aiTitle
        : copy.metadata.baselineTitle;
  const description =
    page === 'privacy'
      ? privacyDescription || copy.metadata.baselineDescription
      : aiVisible
        ? copy.metadata.aiDescription
        : copy.metadata.baselineDescription;
  const canonical = localePath(locale, page);

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: {
      canonical,
      languages: {
        en: localePath('en', page),
        'zh-CN': localePath('zh-CN', page),
        'x-default': localePath('en', page),
      },
    },
    openGraph: {
      type: 'website',
      url: canonical,
      locale: locale === 'en' ? 'en_US' : 'zh_CN',
      siteName: copy.productName,
      title,
      description,
      images: [
        { url: `${ASSET_PREFIX}/assets/bookmark-assistant-og.png`, width: 1200, height: 630 },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${ASSET_PREFIX}/assets/bookmark-assistant-og.png`],
    },
    robots: { index: true, follow: true },
  };
}
