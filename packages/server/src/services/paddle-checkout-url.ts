/**
 * The page Paddle sends buyers to: Paddle appends `?_ptxn=` and the page's Paddle.js opens
 * the checkout. An explicit PADDLE_CHECKOUT_URL wins; otherwise an HTTPS website serves
 * `/checkout`. Local and plain-HTTP sites return undefined, which keeps Paddle's default
 * payment link. Whichever host is used must be approved in Paddle.
 */
export function resolvePaddleCheckoutUrl(input: {
  checkoutUrl?: string;
  websiteUrl?: string;
}): string | undefined {
  const explicit = input.checkoutUrl?.trim();
  if (explicit) return httpsUrl(explicit);
  const website = input.websiteUrl?.trim() ? httpsUrl(input.websiteUrl.trim()) : undefined;
  return website ? new URL('/checkout', website).toString() : undefined;
}

function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
