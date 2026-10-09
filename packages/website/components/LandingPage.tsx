import { EditorialLanding } from '@/components/EditorialLanding';
import { Pricing } from '@/components/sections/Pricing';
import { FAQ } from '@/components/sections/FAQ';
import { FinalCTA } from '@/components/sections/FinalCTA';
import { Footer } from '@/components/sections/Footer';
import { getWebsiteCopy, isAiPublished, type WebsiteLocale } from '@/lib/i18n';
import { CHROME_WEB_STORE_URL, SITE_URL, COMMERCE_ENABLED } from '@/lib/product-links';

export function LandingPage({ locale }: { locale: WebsiteLocale }) {
  const copy = getWebsiteCopy(locale);
  const aiVisible = isAiPublished(copy);
  const softwareApplication = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: copy.productName,
    description: aiVisible ? copy.metadata.aiDescription : copy.metadata.baselineDescription,
    applicationCategory: 'BrowserApplication',
    applicationSubCategory: 'Bookmark manager',
    operatingSystem: 'Chrome',
    browserRequirements: 'Requires Google Chrome',
    url: locale === 'en' ? SITE_URL : `${SITE_URL}/zh-CN`,
    installUrl: CHROME_WEB_STORE_URL,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };

  return (
    <main id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
      <EditorialLanding copy={copy} locale={locale} />
      {COMMERCE_ENABLED ? (
        <Pricing copy={copy} locale={locale} />
      ) : (
        <section id="source" className="mx-auto max-w-6xl px-6 py-10">
          <p>
            {locale === 'en'
              ? 'GPL-3.0-only · Self-hosted deployments include all features. Use your own Notion integration and AI provider key.'
              : 'GPL-3.0-only · 自托管包含全部功能，使用自己的 Notion 集成与 AI Provider Key。'}
          </p>
        </section>
      )}
      <FAQ copy={copy} />
      <FinalCTA copy={copy} />
      <Footer copy={copy} locale={locale} />
    </main>
  );
}
