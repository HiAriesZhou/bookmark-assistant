'use client';

import {
  CheckoutEventNames,
  initializePaddle,
  type Paddle,
  type PaddleEventData,
} from '@paddle/paddle-js';
import { CreditCard, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/product-links';
import { STANDALONE_BODY, STANDALONE_PRIMARY, StandalonePage } from '@/components/StandalonePage';

type Status = 'opening' | 'open' | 'missing' | 'unavailable' | 'closed';

// Paddle.js initializes once per page session; later mounts reuse it and route events to
// the mounted page through this listener.
let paddleReady: Promise<Paddle | undefined> | undefined;
let onCheckoutEvent: (event: PaddleEventData) => void = () => undefined;

/**
 * Landing page for Paddle checkout links. The server creates the transaction and Paddle sends
 * the buyer here with `?_ptxn=`; Paddle.js then opens that transaction's checkout by itself.
 * The webhook, not this page, activates the plan.
 */
export function PaddleCheckout() {
  const [status, setStatus] = useState<Status>('opening');

  useEffect(() => {
    const transactionId = new URLSearchParams(window.location.search).get('_ptxn');
    if (!transactionId) {
      setStatus('missing');
      return;
    }
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      setStatus('unavailable');
      return;
    }
    let loaded = false;
    onCheckoutEvent = (event) => {
      if (event.name === CheckoutEventNames.CHECKOUT_LOADED) {
        loaded = true;
        setStatus('open');
      }
      if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) window.location.assign('/success');
      if (event.name === CheckoutEventNames.CHECKOUT_CLOSED) setStatus('closed');
      // Errors inside an open checkout are shown by Paddle; only one that never loaded is fatal.
      if (event.name === CheckoutEventNames.CHECKOUT_ERROR && !loaded) setStatus('unavailable');
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
        if (!paddle) return setStatus('unavailable');
        // Paddle.js opens ?_ptxn= only when it first initializes; later visits open it here.
        if (!firstLoad) paddle.Checkout.open({ transactionId });
      })
      .catch(() => setStatus('unavailable'));
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
