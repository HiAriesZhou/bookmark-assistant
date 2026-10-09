export const AI_BATCH_AUTO_CONFIRM_LIMIT = 50;

export type AiBatchPlan =
  | { status: 'queued'; requiresConfirmation: false; eligibleCount: number }
  | { status: 'awaiting_confirmation'; requiresConfirmation: true; eligibleCount: number };

/**
 * Keeps base synchronization independent from AI cost: a small batch can start
 * automatically; larger batches require an explicit user confirmation.
 */
export function planAiBatch(eligibleCount: number): AiBatchPlan {
  const count = Math.max(0, Math.floor(eligibleCount));
  return count > AI_BATCH_AUTO_CONFIRM_LIMIT
    ? { status: 'awaiting_confirmation', requiresConfirmation: true, eligibleCount: count }
    : { status: 'queued', requiresConfirmation: false, eligibleCount: count };
}
