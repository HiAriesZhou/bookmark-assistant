/** Per-instance throttle: concurrent requests share work and failures are retried next interval. */
export function createThrottledTask(
  task: () => Promise<void>,
  intervalMs: number
): (now?: number) => Promise<void> {
  let lastStartedAt: number | undefined;
  let inFlight: Promise<void> | undefined;

  return async (now = Date.now()): Promise<void> => {
    if (inFlight) return inFlight;
    if (lastStartedAt !== undefined && now - lastStartedAt < intervalMs) return;
    lastStartedAt = now;
    inFlight = task()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
