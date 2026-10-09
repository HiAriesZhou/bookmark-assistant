import { Logo } from '../icons/Logo';
import { Globe2 } from 'lucide-react';
import {
  CHROME_WEB_STORE_URL,
  PRODUCT_NAME,
  COMMERCE_ENABLED,
  SOURCE_URL,
  NOTION_TEMPLATE_URL,
  REFUND_POLICY_URL,
  SUPPORT_EMAIL,
  TERMS_OF_SERVICE_URL,
} from '@/lib/product-links';
import { localePath, type WebsiteCopy, type WebsiteLocale } from '@/lib/i18n';

export function Footer({ copy, locale }: { copy: WebsiteCopy; locale: WebsiteLocale }) {
  const projectStoryUrl = !COMMERCE_ENABLED
    ? SOURCE_URL
    : locale === 'zh-CN'
      ? 'https://www.arieszhou.com/zh/projects/bookmark-assistant'
      : 'https://www.arieszhou.com/projects/bookmark-assistant';
  return (
    <footer className="editorial-footer border-t border-[#e8eaed] bg-[#fafafa] px-6 py-12">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 md:grid-cols-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Logo className="w-8 h-8" />
              <span className="text-base text-[#16181d]">{PRODUCT_NAME}</span>
            </div>
            <p className="text-sm text-[#667085]">{copy.footer.summary}</p>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#16181d]">{copy.footer.product}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a className="hover:text-[#16181d]" href="#library">
                  {copy.navigation.features}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-[#16181d]"
                  href={COMMERCE_ENABLED ? '#pricing' : '#source'}
                >
                  {COMMERCE_ENABLED ? copy.navigation.pricing : 'GPL-3.0-only'}
                </a>
              </li>
              <li>
                <a className="hover:text-[#16181d]" href="#faq">
                  {copy.navigation.faq}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#16181d]">{copy.footer.resources}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a
                  className="hover:text-gray-900"
                  href={NOTION_TEMPLATE_URL || '#source'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.notionTemplate}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-gray-900"
                  href={CHROME_WEB_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.chromeStore}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-gray-900"
                  href={SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : '#source'}
                >
                  {copy.footer.support}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-gray-900"
                  href={projectStoryUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {locale === 'zh-CN' ? '项目案例' : 'Project story'}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#16181d]">{copy.footer.legal}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a className="hover:text-gray-900" href={localePath(locale, 'privacy')}>
                  {copy.footer.privacy}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-gray-900"
                  href={TERMS_OF_SERVICE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.terms}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-gray-900"
                  href={REFUND_POLICY_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.refund}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="editorial-footer-bottom border-t border-[#e8eaed] pt-8 text-sm text-[#667085]">
          <div>
            {COMMERCE_ENABLED ? (
              <div className="mb-2">
                {copy.footer.poweredBy}{' '}
                <a
                  href="https://www.paddle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-[#b7c3b2] underline-offset-4 hover:text-[#16181d]"
                >
                  Paddle
                </a>
              </div>
            ) : null}
            <div>© 2026 {PRODUCT_NAME}. GPL-3.0-only.</div>
          </div>
          <div className="editorial-language" aria-label={locale === 'zh-CN' ? '语言' : 'Language'}>
            <Globe2 className="h-4 w-4" aria-hidden="true" />
            <div>
              <a
                href={localePath('en', 'home')}
                hrefLang="en"
                aria-current={locale === 'en' ? 'page' : undefined}
              >
                English
              </a>
              <a
                href={localePath('zh-CN', 'home')}
                hrefLang="zh-CN"
                aria-current={locale === 'zh-CN' ? 'page' : undefined}
              >
                中文
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
