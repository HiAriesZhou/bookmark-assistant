import { describe, expect, it, vi } from 'vitest';
import { runSinglePageAiWithRetry } from './single-page-ai-runner';

const task = {
  id: 'task-1',
  userId: 'user-1',
  knowledgeItemId: 'ki-1',
  notionPageId: 'page-1',
  sourceUrl: 'https://example.com',
  mode: 'single_page' as const,
  status: 'processing' as const,
  provider: 'openai',
  model: 'gpt-5-mini',
  promptVersion: 'v1',
  credentialVersion: 1,
  leaseToken: 'lease-1',
};

describe('runSinglePageAiWithRetry', () => {
  it('retries one transient failure without crossing the request boundary', async () => {
    const retry = { ...task, leaseToken: 'lease-2', attemptCount: 2 };
    const execute = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('succeeded');
    const wait = vi.fn(async () => undefined);
    await expect(runSinglePageAiWithRetry(task, execute, async () => retry, wait)).resolves.toBe(
      'succeeded'
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it('does not hold the page body for a long provider Retry-After', async () => {
    const delayed = { ...task, providerRetryAfterMs: 60_000 };
    const claimRetry = vi.fn();
    await expect(runSinglePageAiWithRetry(delayed, async () => 'failed', claimRetry)).resolves.toBe(
      'failed'
    );
    expect(claimRetry).not.toHaveBeenCalled();
  });
});
