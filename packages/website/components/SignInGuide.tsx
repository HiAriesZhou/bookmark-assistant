import { ExternalLink, UserRound } from 'lucide-react';
import type { WebsiteLocale } from '@/lib/i18n';
import { localePath } from '@/lib/i18n';
import { CHROME_WEB_STORE_URL, PRODUCT_NAME } from '@/lib/product-links';
import {
  STANDALONE_BODY,
  STANDALONE_PRIMARY,
  STANDALONE_SECONDARY,
  StandalonePage,
} from '@/components/StandalonePage';

/** Accounts live in the extension; this page explains where to sign in instead of a web form. */
export function SignInGuide({ locale }: { locale: WebsiteLocale }) {
  const zh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const steps = [
    t(`Open ${PRODUCT_NAME} from the Chrome toolbar.`, `从 Chrome 工具栏打开 ${PRODUCT_NAME}。`),
    t('Choose Log in at the bottom left.', '点击左下角的「登录」。'),
    t('Sign in with email or Google.', '使用邮箱或 Google 登录。'),
  ];

  return (
    <StandalonePage
      icon={<UserRound className="h-8 w-8" aria-hidden="true" />}
      eyebrow={t('Account', '账号')}
      title={t('Sign in from the extension', '在扩展中登录')}
    >
      <p className={STANDALONE_BODY}>
        {t(
          'Your account, plan and AI settings live in the Chrome extension. Local bookmark management never needs an account.',
          '账号、套餐和 AI 设置都在 Chrome 扩展里管理。只管理本地书签不需要账号。'
        )}
      </p>
      <ol className="mx-auto mt-6 max-w-sm space-y-2 text-left text-base leading-7 text-[#344054]">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#e8eaed] text-xs font-semibold text-[#667085]">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <a
          href={CHROME_WEB_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={STANDALONE_PRIMARY}
        >
          {t('Install for Chrome', '安装 Chrome 扩展')}
          <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
        </a>
        <a href={localePath(locale, 'home')} className={STANDALONE_SECONDARY}>
          {t('Back to home', '返回首页')}
        </a>
      </div>
    </StandalonePage>
  );
}
