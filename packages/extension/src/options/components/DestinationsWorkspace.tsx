import { useEffect, useRef } from 'react';
import { createTranslator } from '../../utils/i18n';
import { useAppStore } from '../store';
import { OverviewSection } from './OverviewSection';
import { Workspace } from './Workspace';

export function DestinationsWorkspace() {
  const { t } = createTranslator();
  const { refreshDashboard } = useAppStore();
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void refreshDashboard(false);
  }, [refreshDashboard]);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-library-ink">
          {t('nav_destinations')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-library-muted">
          {t('destinations_page_description')}
        </p>
      </header>

      <Workspace
        id="destinations"
        label={t('nav_destinations')}
        className="mt-8 !rounded-xl !border-library-line !shadow-none"
      >
        <OverviewSection />
      </Workspace>
    </div>
  );
}
