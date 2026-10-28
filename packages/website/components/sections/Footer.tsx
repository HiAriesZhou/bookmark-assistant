import { Logo } from '../icons/Logo';
import { Globe2 } from 'lucide-react';
import {
  CHROME_WEB_STORE_URL,
  PRODUCT_NAME,
  NOTION_TOKEN_GUIDE_URL,
  SUPPORT_EMAIL,
  TERMS_OF_SERVICE_URL,
  projectStoryUrl,
} from '@/lib/product-links';
import { localePath, type WebsiteCopy, type WebsiteLocale } from '@/lib/i18n';

export function Footer({ copy, locale }: { copy: WebsiteCopy; locale: WebsiteLocale }) {
  return (
    <footer className="border-t border-[#dce0d4] bg-[#f9f9f5] px-6 py-12">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 md:grid-cols-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Logo className="w-8 h-8" />
              <span className="text-base text-[#29352e]">{PRODUCT_NAME}</span>
            </div>
            <p className="text-sm text-[#667085]">{copy.footer.summary}</p>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#29352e]">{copy.footer.product}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a className="hover:text-[#334f40]" href="#library">
                  {copy.navigation.features}
                </a>
              </li>
              <li>
                <a className="hover:text-[#334f40]" href="#source">
                  GPL-3.0-only
                </a>
              </li>
              <li>
                <a className="hover:text-[#334f40]" href="#faq">
                  {copy.navigation.faq}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#29352e]">{copy.footer.resources}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a
                  className="hover:text-[#334f40]"
                  href={NOTION_TOKEN_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.notionGuide}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-[#334f40]"
                  href={CHROME_WEB_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.chromeStore}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-[#334f40]"
                  href={SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : '#source'}
                >
                  {copy.footer.support}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-[#334f40]"
                  href={projectStoryUrl(locale)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {locale === 'zh-CN' ? '项目案例' : 'Project story'}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-base text-[#29352e]">{copy.footer.legal}</h4>
            <ul className="space-y-2 text-sm text-[#667085]">
              <li>
                <a className="hover:text-[#334f40]" href={localePath(locale, 'privacy')}>
                  {copy.footer.privacy}
                </a>
              </li>
              <li>
                <a
                  className="hover:text-[#334f40]"
                  href={TERMS_OF_SERVICE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.footer.terms}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="editorial-footer-bottom border-t border-[#e8eaed] pt-8 text-sm text-[#667085]">
          <div>
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
