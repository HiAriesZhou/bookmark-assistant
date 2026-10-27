import { checkoutEmbedUrl, isCheckoutEmbedMessage } from '@bookmark-assistant/types';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openCheckoutWindow } from '../../lib/paddle';
import { createTranslator } from '../../utils/i18n';

// Paddle.js and the checkout normally load within a few seconds.
export const CHECKOUT_LOAD_TIMEOUT_MS = 20_000;

/**
 * Pays without leaving the settings page: the website checkout page runs Paddle.js in a
 * transparent full-page frame, so Paddle's overlay appears over this page. The frame reports
 * progress by postMessage. If it cannot load, the checkout opens in a small window instead.
 */
export function CheckoutDialog({
  checkoutUrl,
  onClose,
  onCompleted,
  onFallback,
}: {
  checkoutUrl: string;
  onClose: () => void;
  onCompleted: () => void;
  onFallback: () => void;
}) {
  const { t } = createTranslator();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef({ onClose, onCompleted, onFallback });
  callbacks.current = { onClose, onCompleted, onFallback };

  useEffect(() => {
    let settled = false;
    const origin = new URL(checkoutUrl).origin;
    const fallBack = () => {
      if (settled) return;
      settled = true;
      void openCheckoutWindow(checkoutUrl);
      callbacks.current.onFallback();
      callbacks.current.onClose();
    };
    const timer = window.setTimeout(fallBack, CHECKOUT_LOAD_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      if (!isCheckoutEmbedMessage(event.data)) return;
      const { status } = event.data;
      if (status === 'loaded') {
        window.clearTimeout(timer);
        setLoaded(true);
      } else if (status === 'completed') {
        settled = true;
        callbacks.current.onCompleted();
      } else if (status === 'closed') {
        settled = true;
        callbacks.current.onClose();
      } else {
        window.clearTimeout(timer);
        fallBack();
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [checkoutUrl]);

  return createPortal(
    <div className="fixed inset-0 z-50">
      <iframe
        ref={frameRef}
        src={checkoutEmbedUrl(checkoutUrl)}
        title={t('checkout_frame_title')}
        allow="payment"
        className="absolute inset-0 h-full w-full border-0 bg-transparent"
      />
      {loaded ? null : (
        <div className="absolute inset-0 flex items-center justify-center bg-ui-ink/35 p-4 backdrop-blur-[2px]">
          <div
            role="status"
            aria-live="polite"
            className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-library-line bg-white p-5 text-center shadow-xl"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-5 w-5 text-ui-subtle motion-safe:animate-spin"
            />
            <p className="text-sm font-medium text-library-ink">{t('checkout_opening')}</p>
            <button type="button" onClick={onClose} className="library-secondary-button">
              {t('action_cancel')}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
