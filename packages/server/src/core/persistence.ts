export type PersistenceErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function isRetryablePersistenceError(error: unknown): boolean {
  const errorLike = error as PersistenceErrorLike | null | undefined;
  const code = typeof errorLike?.code === 'string' ? errorLike.code : undefined;
  const message = typeof errorLike?.message === 'string' ? errorLike.message : undefined;

  if (code === 'P2024' || code === 'P1001') {
    return true;
  }

  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes('connection pool') ||
    normalized.includes('timed out fetching') ||
    normalized.includes('maxclientsinsessionmode') ||
    normalized.includes('max clients reached')
  );
}
