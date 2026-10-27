import { useEffect, useRef } from 'react';
// GitHub's mark belongs to GitHub; it only identifies where the source is hosted (see NOTICE).
import { Github } from 'lucide-react';
import { createTranslator } from '../../utils/i18n';
import { AccountSection, AccountSignIn } from './AccountSection';
import { AccountActions } from './AccountActions';
import { PLAN_UPGRADE_ID } from './PlanRows';
import { SyncSettingsSection } from './SyncSettingsSection';
import { AiSettingsSection } from './AiSettingsSection';
import { selectPlanPending, useAppStore } from '../store';
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
  const {
    isSignedIn,
    userId,
    refreshDashboard,
    refreshEntitlements,
    deploymentMode,
    capabilities,
    isPro,
  } = useAppStore();
  const planPending = useAppStore(selectPlanPending);
  // Hosted Free shows no Pro feature entries; self-hosted servers include every capability.
  const selfHosted = deploymentMode === 'self-hosted';
  const showAi = !planPending && (selfHosted || (capabilities?.batchAi ?? isPro));
  const showSync = !planPending && (selfHosted || (capabilities?.autoSync ?? isPro));
  // Remote state is requested once per account, so a later sign-in never shows the previous plan.
  const accountKey = isSignedIn ? `account:${userId}` : '';
  const requestedRemoteState = useRef<string>();
  const requestedEntitlements = useRef<string>();
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

  const showUpgrade = () =>
    document
      .getElementById(PLAN_UPGRADE_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return (
    // A full-height column, so the footer sits at the bottom of the pane on short pages.
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      {isSignedIn ? (
        <div id="settings" aria-label={t('settings_workspace_label')} className="space-y-9">
          <AccountSection />
          {showAi ? (
            <AiSettingsSection
              active={active}
              onUpgrade={showUpgrade}
              onOpenDestinations={openDestinations}
            />
          ) : null}
          {showSync ? <SyncSettingsSection onOpenDestinations={openDestinations} /> : null}
          <AccountActions />
        </div>
      ) : (
        <div
          id="settings"
          aria-label={t('settings_workspace_label')}
          className="flex flex-1 flex-col"
        >
          <AccountSignIn onOpenDestinations={openDestinations} />
        </div>
      )}
      <footer className="mt-auto flex flex-col items-center gap-3 px-1 pt-10 text-xs text-library-muted">
        {isSignedIn ? (
          <a
            href={productConfig.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-center leading-5 hover:text-library-ink hover:underline"
          >
            <Github aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {t('footer_star_request')}
          </a>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
        </div>
      </footer>
    </div>
  );
}
