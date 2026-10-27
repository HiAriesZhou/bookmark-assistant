import { useCallback, useEffect, useRef } from 'react';
import { createTranslator } from '../../utils/i18n';
import { useAppStore } from '../store';
import { useToast } from './useToast';

// Paddle grants Pro through a webhook, which usually lands within seconds of payment.
export const UPGRADE_POLL_INTERVAL_MS = 4_000;
export const UPGRADE_POLL_ATTEMPTS = 15;

/**
 * After a checkout opens in another tab, re-reads the plan whenever the user returns to this
 * page, for about a minute each time, and announces Pro once it arrives. The webhook decides
 * the plan; this only stops the user from having to press refresh.
 */
export function useUpgradeActivation() {
  const { t } = createTranslator();
  const { show } = useToast();
  const isPro = useAppStore((state) => state.isPro);
  const refreshEntitlements = useAppStore((state) => state.refreshEntitlements);
  const awaiting = useRef(false);
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!isPro || !awaiting.current) return;
    awaiting.current = false;
    stopPolling();
    show({
      variant: 'success',
      title: t('pro_activated_title'),
      description: t('pro_activated_desc'),
    });
  }, [isPro, show, stopPolling, t]);

  useEffect(() => {
    const onReturn = () => {
      if (!awaiting.current || document.visibilityState === 'hidden' || timer.current !== null)
        return;
      let attempts = 0;
      const poll = () => {
        attempts += 1;
        void refreshEntitlements(true);
        if (attempts >= UPGRADE_POLL_ATTEMPTS) stopPolling();
      };
      timer.current = window.setInterval(poll, UPGRADE_POLL_INTERVAL_MS);
      poll();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      stopPolling();
    };
  }, [refreshEntitlements, stopPolling]);

  const expectUpgrade = useCallback(() => {
    awaiting.current = true;
  }, []);

  return { expectUpgrade };
}
