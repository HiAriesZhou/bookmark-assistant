import type { AiGenerationStatus } from '@bookmark-assistant/types';
import type { ExecutableAiTask } from './ai-task-executor';

const MAX_IN_REQUEST_RETRY_DELAY_MS = 5_000;

/** Runs a single-page task and, when possible, one transient retry while its body remains in memory. */
export async function runSinglePageAiWithRetry(
  initialTask: ExecutableAiTask,
  execute: (task: ExecutableAiTask) => Promise<AiGenerationStatus>,
  claimRetry: () => Promise<ExecutableAiTask | undefined>,
  wait: (milliseconds: number) => Promise<void> = delay
): Promise<AiGenerationStatus> {
  let status = await execute(initialTask);
  if (status !== 'failed') return status;

  const retryDelayMs = initialTask.providerRetryAfterMs ?? 1_000;
  // A long Retry-After cannot be honored without retaining the page body across
  // requests, which the privacy contract forbids.
  if (retryDelayMs > MAX_IN_REQUEST_RETRY_DELAY_MS) return status;

  await wait(Math.max(1_000, retryDelayMs));
  const retry = await claimRetry();
  if (retry) status = await execute(retry);
  return status;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
