import { describe, expect, it, vi } from 'vitest';
import { createOpportunisticDescriptionCacheCleanup } from './cache-cleanup';

describe('opportunistic description-cache cleanup', () => {
  it('runs once per interval', async () => {
    const cleanup = vi.fn(async () => undefined);
    const run = createOpportunisticDescriptionCacheCleanup(cleanup, 100);

    await run(1_000);
    await run(1_050);
    await run(1_100);

    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight cleanup and allows later retries after failure', async () => {
    let finish: (() => void) | undefined;
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockRejectedValueOnce(new Error('temporary failure'));
    const run = createOpportunisticDescriptionCacheCleanup(cleanup, 100);

    const first = run(1_000);
    const second = run(1_001);
    expect(cleanup).toHaveBeenCalledTimes(1);
    finish?.();
    await Promise.all([first, second]);
    await expect(run(1_100)).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});

