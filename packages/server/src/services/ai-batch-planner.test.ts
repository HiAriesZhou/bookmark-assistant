import { describe, expect, it } from 'vitest';
import { AI_BATCH_AUTO_CONFIRM_LIMIT, planAiBatch } from './ai-batch-planner';

describe('planAiBatch', () => {
  it('queues up to 50 eligible items without confirmation', () => {
    expect(planAiBatch(AI_BATCH_AUTO_CONFIRM_LIMIT)).toEqual({ status: 'queued', requiresConfirmation: false, eligibleCount: 50 });
  });
  it('requires confirmation beyond the configured limit', () => {
    expect(planAiBatch(51)).toEqual({ status: 'awaiting_confirmation', requiresConfirmation: true, eligibleCount: 51 });
  });
  it('normalizes invalid counts safely', () => {
    expect(planAiBatch(-4.8)).toEqual({ status: 'queued', requiresConfirmation: false, eligibleCount: 0 });
  });
});
