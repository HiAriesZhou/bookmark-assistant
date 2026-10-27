import { useCallback, useEffect, useRef } from 'react';
import { createTranslator } from '../../utils/i18n';
import { useAppStore } from '../store';
import { useToast } from './useToast';

// Paddle grants Pro through a webhook, which usually lands within seconds of payment.
export const UPGRADE_POLL_INTERVAL_MS = 4_000;
export const UPGRADE_POLL_ATTEMPTS = 15;

/**
 * Re-reads the plan after a checkout, for about a minute at a time, and announces Pro once
 * it arrives: right away when the embedded checkout reports payment, or when the user returns
 * from a checkout window. The webhook decides
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

  const startPolling = useCallback(() => {
    if (timer.current !== null) return;
    let attempts = 0;
    const poll = () => {
      attempts += 1;
      void refreshEntitlements(true);
      if (attempts >= UPGRADE_POLL_ATTEMPTS) stopPolling();
    };
    timer.current = window.setInterval(poll, UPGRADE_POLL_INTERVAL_MS);
    poll();
  }, [refreshEntitlements, stopPolling]);

  useEffect(() => {
    const onReturn = () => {
      if (awaiting.current && document.visibilityState !== 'hidden') startPolling();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  /** Checkout continues elsewhere (a window or tab); poll when the user comes back. */
  const expectUpgrade = useCallback(() => {
    awaiting.current = true;
  }, []);

  /** The embedded checkout reported payment; poll now until the webhook grants Pro. */
  const checkNow = useCallback(() => {
    awaiting.current = true;
    startPolling();
  }, [startPolling]);

  return { expectUpgrade, checkNow };
}
