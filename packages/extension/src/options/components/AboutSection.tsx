import { ExternalLink } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { formatLastUpdated } from '../../utils/common';
import { useAppStore } from '../store';
import { createTranslator } from '../../utils/i18n';
import logoUrl from '@product-logo';
import { productConfig } from '../../product-config';

export function AboutSection() {
  const { t } = createTranslator();
  const { version } = useAppStore();
  const lastUpdated = formatLastUpdated();
  return (
    <SectionCard id="about" title={t('about_title')} description={t('about_desc')}>
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col items-center text-center">
          <img
            src={logoUrl}
            alt="Bookmark Assistant logo"
            className="w-16 h-16 rounded-xs object-cover mb-2"
          />
          <div className="text-lg font-semibold text-gray-900">{t('about_app_name')}</div>
          <div className="text-xs text-gray-500">{t('about_version', [version || '—'])}</div>
          <div className="text-sm text-gray-600 mt-1">{t('about_description')}</div>
        </div>

        <hr className="my-5 border-gray-200" />

        <div className="grid grid-cols-1 grid-rows-2 gap-4 text-sm">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <span className="text-gray-600">{t('license')}</span>
            <a
              href="LICENSE.txt"
              target="_blank"
              rel="noreferrer"
              className="text-gray-900 font-medium"
            >
              GPL-3.0-only
            </a>
          </div>
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <span className="text-gray-600">{t('last_updated')}</span>
            <span className="text-gray-900 font-medium">{lastUpdated}</span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <a
            href={productConfig.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center gap-2 text-gray-800 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
            aria-label={t('product_website')}
          >
            <ExternalLink className="w-4 h-4" /> {t('product_website')}
          </a>
          {productConfig.faqUrl ? (
            <a
              href={productConfig.faqUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full inline-flex items-center gap-2 text-gray-800 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
              aria-label={t('documentation')}
            >
              <ExternalLink className="w-4 h-4" /> {t('documentation')}
            </a>
          ) : null}
          {productConfig.supportUrl ? (
            <a
              href={productConfig.supportUrl}
              className="w-full inline-flex items-center gap-2 text-gray-800 hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
              aria-label={t('support')}
            >
              <ExternalLink className="w-4 h-4" /> {t('support')}
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-sm text-gray-700">
          {t('made_with_love', ['❤️'])}
        </div>
      </div>
    </SectionCard>
  );
}
