import { EditorialLanding } from '@/components/EditorialLanding';
import { FAQ } from '@/components/sections/FAQ';
import { FinalCTA } from '@/components/sections/FinalCTA';
import { Footer } from '@/components/sections/Footer';
import { getWebsiteCopy, isAiPublished, type WebsiteLocale } from '@/lib/i18n';
import { CHROME_WEB_STORE_URL, SITE_URL, SOURCE_URL } from '@/lib/product-links';

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
      <section id="source" className="mx-auto max-w-6xl px-6 py-10">
        <p>
          {locale === 'en'
            ? 'Free and open source under GPL-3.0-only. Runs in your browser with your own Notion token and AI provider key. '
            : '免费开源，采用 GPL-3.0-only 许可。在浏览器中运行，使用你自己的 Notion 令牌和 AI 服务商 key。'}
          <a
            className="underline decoration-[#b7c3b2] underline-offset-4 hover:text-[#334f40]"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            {locale === 'en' ? 'View source' : '查看源码'}
          </a>
        </p>
      </section>
      <FAQ copy={copy} />
      <FinalCTA copy={copy} />
      <Footer copy={copy} locale={locale} />
    </main>
  );
}
