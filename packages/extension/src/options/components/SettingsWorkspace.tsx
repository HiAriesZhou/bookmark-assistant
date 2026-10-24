import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { AccountSection, AccountSignIn } from './AccountSection';
import { BillingSection } from './BillingSection';
import { ServiceDataSection } from './ServiceDataSection';
import { SyncSettingsSection } from './SyncSettingsSection';
import { AiSettingsSection } from './AiSettingsSection';
import { DestinationsSummarySection } from './DestinationsSummarySection';
import { useAppStore } from '../store';
import { productConfig } from '../../product-config';
import type { RouteId } from '../router';

export function SettingsWorkspace({
  active = true,
  onNavigate,
}: {
  active?: boolean;
  onNavigate: (to: RouteId) => void;
}) {
  const { t } = createTranslator();
  const [plansExpanded, setPlansExpanded] = useState(false);
  const {
    fetchPricing,
    isSignedIn,
    userId,
    refreshDashboard,
    refreshEntitlements,
    commerceEnabled,
    deploymentMode,
  } = useAppStore();
  // Remote state is requested once per account, so a later sign-in never shows the previous plan.
  const accountKey = isSignedIn ? `account:${userId}` : '';
  const requestedRemoteState = useRef<string>();
  const requestedEntitlements = useRef<string>();
  const requestedPricing = useRef(false);
  const openDestinations = () => onNavigate('destinations');
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
  const sections = [
    { id: 'account', label: t('account_title') },
    { id: 'ai', label: 'AI' },
    { id: 'sync', label: t('nav_sync_settings') },
    { id: 'destinations-summary', label: t('nav_destinations') },
  ];

  useEffect(() => {
    const key = accountKey || 'signed-out';
    if (requestedRemoteState.current === key) return;
    requestedRemoteState.current = key;
    void refreshDashboard(false);
  }, [accountKey, refreshDashboard]);

  useEffect(() => {
    if (!accountKey) {
      requestedEntitlements.current = undefined;
      return;
    }
    if (requestedEntitlements.current === accountKey) return;
    requestedEntitlements.current = accountKey;
    void refreshEntitlements();
  }, [accountKey, refreshEntitlements]);

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

  const scrollToSection = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mx-auto max-w-3xl">
      {isSignedIn ? (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-library-ink">
              {t('nav_settings')}
            </h1>
            <nav
              aria-label={t('settings_sections_label')}
              className="flex w-full gap-0.5 overflow-x-auto rounded-lg border border-ui-line bg-ui-surface p-0.5 sm:w-auto"
            >
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className="h-7 flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-ui-subtle hover:bg-ui-surface-hover hover:text-ui-ink sm:flex-none"
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </header>
          <div id="settings" aria-label={t('settings_workspace_label')} className="mt-8 space-y-9">
            <AccountSection />
            {deploymentMode === 'self-hosted' ? (
              <p className="text-sm text-library-muted">{t('deployment_self_hosted')}</p>
            ) : commerceEnabled ? (
              <BillingSection plansExpanded={plansExpanded} onTogglePlans={togglePlans} />
            ) : null}
            <AiSettingsSection
              active={active}
              onUpgrade={() => togglePlans(true)}
              onOpenDestinations={openDestinations}
            />
            <SyncSettingsSection
              onUpgrade={() => togglePlans(true)}
              onOpenDestinations={openDestinations}
            />
            <DestinationsSummarySection onOpenDestinations={openDestinations} />
            <ServiceDataSection />
          </div>
        </>
      ) : (
        <div id="settings" aria-label={t('settings_workspace_label')}>
          <AccountSignIn />
        </div>
      )}
      <footer
        className={`mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-library-muted ${isSignedIn ? '' : 'justify-center'}`}
      >
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
