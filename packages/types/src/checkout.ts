/**
 * Messages between the website checkout page and the extension page that embeds it.
 * The page only reports checkout progress; the Paddle webhook still grants the plan.
 */
export const CHECKOUT_EMBED_PARAM = 'embed';
export const CHECKOUT_MESSAGE_SOURCE = 'bookmark-assistant-checkout';
export const CHECKOUT_EMBED_STATUSES = ['loaded', 'completed', 'closed', 'unavailable'] as const;

export type CheckoutEmbedStatus = (typeof CHECKOUT_EMBED_STATUSES)[number];

export interface CheckoutEmbedMessage {
  source: typeof CHECKOUT_MESSAGE_SOURCE;
  status: CheckoutEmbedStatus;
}

export function isCheckoutEmbedMessage(value: unknown): value is CheckoutEmbedMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<CheckoutEmbedMessage>;
  return (
    message.source === CHECKOUT_MESSAGE_SOURCE &&
    (CHECKOUT_EMBED_STATUSES as readonly unknown[]).includes(message.status)
  );
}

/** The checkout link with the flag that tells the page it runs inside the extension. */
export function checkoutEmbedUrl(checkoutUrl: string): string {
  const url = new URL(checkoutUrl);
  url.searchParams.set(CHECKOUT_EMBED_PARAM, '1');
  return url.toString();
}
