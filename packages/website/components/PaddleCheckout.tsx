'use client';

import {
  CheckoutEventNames,
  initializePaddle,
  type Paddle,
  type PaddleEventData,
} from '@paddle/paddle-js';
import { CreditCard, LoaderCircle } from 'lucide-react';
import {
  CHECKOUT_EMBED_PARAM,
  CHECKOUT_MESSAGE_SOURCE,
  type CheckoutEmbedStatus,
} from '@bookmark-assistant/types';
import { useEffect, useState } from 'react';
import { PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/product-links';
import { STANDALONE_BODY, STANDALONE_PRIMARY, StandalonePage } from '@/components/StandalonePage';

type Status = 'opening' | 'open' | 'missing' | 'unavailable' | 'closed';

// Paddle.js initializes once per page session; later mounts reuse it and route events to
// the mounted page through this listener.
let paddleReady: Promise<Paddle | undefined> | undefined;
let onCheckoutEvent: (event: PaddleEventData) => void = () => undefined;

/**
 * Reports checkout progress to the extension page that embeds this one. frame-ancestors
 * limits who can embed /checkout, and the messages carry status only.
 */
function notifyExtension(status: CheckoutEmbedStatus) {
  const parentOrigin = window.location.ancestorOrigins?.[0];
  if (!parentOrigin?.startsWith('chrome-extension://')) return;
  window.parent.postMessage({ source: CHECKOUT_MESSAGE_SOURCE, status }, parentOrigin);
}

/**
 * Landing page for Paddle checkout links. The server creates the transaction and Paddle sends
 * the buyer here with `?_ptxn=`; Paddle.js then opens that transaction's checkout by itself.
 * Inside the extension (`?embed=1`) the page is transparent, so only Paddle's overlay shows
 * over the settings page, and it reports progress instead of navigating. The webhook, not
 * this page, activates the plan.
 */
export function PaddleCheckout() {
  const [status, setStatus] = useState<Status>('opening');
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isEmbedded = params.get(CHECKOUT_EMBED_PARAM) === '1';
    if (isEmbedded) {
      setEmbedded(true);
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    }
    const report = (next: Status) => {
      setStatus(next);
      if (!isEmbedded) return;
      if (next === 'open') notifyExtension('loaded');
      if (next === 'closed') notifyExtension('closed');
      if (next === 'missing' || next === 'unavailable') notifyExtension('unavailable');
    };
    const transactionId = params.get('_ptxn');
    if (!transactionId) return report('missing');
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) return report('unavailable');
    let loaded = false;
    onCheckoutEvent = (event) => {
      if (event.name === CheckoutEventNames.CHECKOUT_LOADED) {
        loaded = true;
        report('open');
      }
      if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
        if (isEmbedded) notifyExtension('completed');
        else window.location.assign('/success');
      }
      if (event.name === CheckoutEventNames.CHECKOUT_CLOSED) report('closed');
      // Errors inside an open checkout are shown by Paddle; only one that never loaded is fatal.
      if (event.name === CheckoutEventNames.CHECKOUT_ERROR && !loaded) report('unavailable');
    };
    const firstLoad = !paddleReady;
    paddleReady ??= initializePaddle({
      token,
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
      checkout: { settings: { variant: 'one-page' } },
      eventCallback: (event) => onCheckoutEvent(event),
    });
    paddleReady
      .then((paddle) => {
        if (!paddle) return report('unavailable');
        // Paddle.js opens ?_ptxn= only when it first initializes; later visits open it here.
        if (!firstLoad) paddle.Checkout.open({ transactionId });
      })
      .catch(() => report('unavailable'));
  }, []);

  const copy = {
    opening: ['Opening secure checkout', 'Paddle handles the payment in a secure window.'],
    open: ['Complete your upgrade', 'Finish the payment in the Paddle window.'],
    missing: [
      'No checkout to open',
      `Start the upgrade from Settings in the ${PRODUCT_NAME} extension.`,
    ],
    unavailable: [
      'Checkout could not open',
      SUPPORT_EMAIL
        ? `Please try again from the extension, or contact ${SUPPORT_EMAIL}.`
        : 'Please try again from the extension.',
    ],
    closed: [
      'Checkout closed',
      'Your plan has not changed. You can reopen checkout or start again from the extension.',
    ],
  }[status];

  if (embedded) {
    return (
      <p className="sr-only" role="status" aria-live="polite">
        {copy[0]}
      </p>
    );
  }

  return (
    <StandalonePage
      icon={
        status === 'opening' ? (
          <LoaderCircle className="h-8 w-8 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard className="h-8 w-8" aria-hidden="true" />
        )
      }
      eyebrow={`${PRODUCT_NAME} Pro`}
      title={copy[0]}
    >
      <p className={STANDALONE_BODY} role="status" aria-live="polite">
        {copy[1]}
      </p>
      {status === 'closed' ? (
        // Reloading keeps ?_ptxn=, so Paddle.js opens the same transaction again.
        <button
          type="button"
          className={`mt-8 ${STANDALONE_PRIMARY}`}
          onClick={() => window.location.reload()}
        >
          Reopen checkout
        </button>
      ) : null}
    </StandalonePage>
  );
}
