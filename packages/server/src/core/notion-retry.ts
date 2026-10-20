export type NotionErrorLike = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  headers?: unknown;
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'rate_limited',
  'internal_server_error',
  'bad_gateway',
  'service_unavailable',
  'database_connection_unavailable',
  'gateway_timeout',
]);

function getNotionErrorStatus(error: unknown): number | undefined {
  const status = (error as NotionErrorLike | null | undefined)?.status;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d{3}$/.test(status)) return Number(status);

  const message = (error as NotionErrorLike | null | undefined)?.message;
  const match = typeof message === 'string' ? message.match(/status:\s*(\d{3})/i) : undefined;
  return match ? Number(match[1]) : undefined;
}

export function isRetryableNotionError(error: unknown): boolean {
  const errorLike = error as NotionErrorLike | null | undefined;
  const status = getNotionErrorStatus(error);
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true;

  const code = typeof errorLike?.code === 'string' ? errorLike.code : undefined;
  if (code && RETRYABLE_CODES.has(code)) return true;

  const message = typeof errorLike?.message === 'string' ? errorLike.message.toLowerCase() : '';
  return (
    message.includes('econnreset') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable')
  );
}

export function getNotionRetryDelayMs(error: unknown, attempt: number): number {
  const errorLike = error as NotionErrorLike | null | undefined;
  if (getNotionErrorStatus(error) === 429) {
    const headers = errorLike?.headers as { get?: (name: string) => string | null } | undefined;
    const retryAfter = Number(headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  }

  // Bounded exponential backoff with a small deterministic jitter per attempt.
  return Math.min(8_000, 750 * 2 ** attempt) + attempt * 125;
}
