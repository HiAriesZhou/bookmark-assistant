import { describe, expect, it, vi } from 'vitest';
import {
  AI_DIAGNOSTIC_OPPORTUNISTIC_CLEANUP_INTERVAL_MS,
  createOpportunisticAiDiagnosticCleanup,
} from './ai-diagnostic-cleanup';

describe('opportunistic AI diagnostic cleanup', () => {
  it('runs on the first opportunity and at most once per interval', async () => {
    const cleanup = vi.fn(async () => undefined);
    const trigger = createOpportunisticAiDiagnosticCleanup(cleanup);

    await trigger(1_000);
    await trigger(2_000);
    await trigger(1_000 + AI_DIAGNOSTIC_OPPORTUNISTIC_CLEANUP_INTERVAL_MS);

    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('does not let cleanup failures reject an AI request', async () => {
    const trigger = createOpportunisticAiDiagnosticCleanup(async () => {
      throw new Error('database unavailable');
    });

    await expect(trigger(1_000)).resolves.toBeUndefined();
  });
});
