import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { AccountSection } from './AccountSection';
import { BillingSection } from './BillingSection';
import { SyncSettingsSection } from './SyncSettingsSection';
import { AiSettingsSection } from './AiSettingsSection';
import { useAppStore } from '../store';
import { productConfig } from '../../product-config';

export function SettingsWorkspace({ active = true }: { active?: boolean }) {
  const { t } = createTranslator();
  const [plansExpanded, setPlansExpanded] = useState(false);
  const {
    fetchPricing,
    isSignedIn,
    refreshDashboard,
    refreshEntitlements,
    commerceEnabled,
    deploymentMode,
  } = useAppStore();
  const requestedRemoteState = useRef(false);
  const requestedEntitlements = useRef(false);
  const requestedPricing = useRef(false);
  const supportLinks = [
    {
      label: t('faq_guide'),
      url: productConfig.faqUrl,
    },
    {
      label: t('privacy'),
      url: productConfig.privacyUrl,
    },
    {
      label: t('terms'),
      url: productConfig.termsUrl,
    },
  ];

  useEffect(() => {
    if (requestedRemoteState.current) return;
    requestedRemoteState.current = true;
    void refreshDashboard(false);
  }, [refreshDashboard]);

  useEffect(() => {
    if (!isSignedIn || requestedEntitlements.current) return;
    requestedEntitlements.current = true;
    void refreshEntitlements();
  }, [isSignedIn, refreshEntitlements]);

  const togglePlans = (next?: boolean) => {
    if (!commerceEnabled || deploymentMode === 'self-hosted') return;
    const shouldExpand = next ?? !plansExpanded;
    setPlansExpanded(shouldExpand);
    if (shouldExpand) {
      if (!requestedPricing.current) {
        requestedPricing.current = true;
        void fetchPricing();
      }
      window.requestAnimationFrame(() => {
        const comparison = document.getElementById('plan-comparison');
        comparison?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        comparison?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-library-ink">
          {t('nav_settings')}
        </h1>
      </header>
      <div id="settings" aria-label={t('settings_workspace_label')} className="mt-8 space-y-9">
        <AccountSection />
        <AiSettingsSection active={active} onUpgrade={() => togglePlans(true)} />
        <SyncSettingsSection onUpgrade={() => togglePlans(true)} />
        {deploymentMode === 'self-hosted' ? (
          <p className="text-sm text-library-muted">{t('deployment_self_hosted')}</p>
        ) : commerceEnabled ? (
          <BillingSection plansExpanded={plansExpanded} onTogglePlans={togglePlans} />
        ) : null}
      </div>
      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-library-muted">
        <a
          href="LICENSE.txt"
          target="_blank"
          rel="noreferrer"
          className="hover:text-library-ink hover:underline"
        >
          GPL-3.0-only
        </a>
        {supportLinks
          .filter((link) => link.url)
          .map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
              className="hover:text-library-ink hover:underline"
            >
              {link.label}
            </button>
          ))}
      </footer>
    </div>
  );
}
