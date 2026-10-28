import { useEffect, useRef } from 'react';
// GitHub's mark belongs to GitHub; it only identifies where the source is hosted (see NOTICE).
import { Github } from 'lucide-react';
import { createTranslator } from '../../utils/i18n';
import { SyncSettingsSection } from './SyncSettingsSection';
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
  const { refreshDashboard } = useAppStore();
  const requestedDashboard = useRef(false);
  const openDestinations = () => onNavigate('destinations');
  const supportLinks = [
    { label: t('faq_guide'), url: productConfig.faqUrl },
    { label: t('privacy'), url: productConfig.privacyUrl },
    { label: t('terms'), url: productConfig.termsUrl },
  ];

  // Sync settings read the connection state from the dashboard snapshot.
  useEffect(() => {
    if (!active || requestedDashboard.current) return;
    requestedDashboard.current = true;
    void refreshDashboard(false);
  }, [active, refreshDashboard]);

  return (
    // A full-height column, so the footer sits at the bottom of the pane on short pages.
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div id="settings" aria-label={t('settings_workspace_label')} className="space-y-9">
        <SyncSettingsSection onOpenDestinations={openDestinations} />
      </div>
      <footer className="mt-auto flex flex-col items-center gap-3 px-1 pt-10 text-xs text-library-muted">
        <a
          href={productConfig.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-center leading-5 hover:text-library-ink hover:underline"
        >
          <Github aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {t('footer_star_request')}
        </a>
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
