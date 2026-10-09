import { ReactNode } from 'react';
import logoUrl from '@product-logo';
import { Mail } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { createTranslator } from '../../utils/i18n';

export function SectionCard({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card
      id={id}
      className="h-full scroll-mt-24 rounded-2xl border-ui-line bg-ui-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ui-ink">{title}</h2>
          </span>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-ui-subtle">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

export function PageHeader() {
  const { t } = createTranslator();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || 'aries0331.dev@gmail.com';

  const handleSupportClick = () => {
    window.open(`mailto:${supportEmail}?subject=Bookmark Assistant Support`, '_blank');
  };

  return (
    <header className="sticky top-0 z-20 border-b border-ui-line bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <img
            src={logoUrl}
            alt="Bookmark Assistant logo"
            className="h-9 w-9 rounded-lg object-cover shadow-sm"
          />
          <span className="text-sm font-semibold leading-tight tracking-[-0.01em] text-ui-ink">
            {t('header_title')}
          </span>
        </div>

        <button
          onClick={handleSupportClick}
          className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-ui-subtle transition-colors hover:border-ui-line hover:bg-ui-muted hover:text-ui-ink"
          title={t('contact_support')}
        >
          <Mail className="w-4 h-4" />
          <span className="hidden sm:inline">{t('support')}</span>
        </button>
      </div>
    </header>
  );
}
