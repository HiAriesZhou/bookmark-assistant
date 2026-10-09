import { describe, expect, it } from 'vitest';
import {
  canStartDescriptionExtraction,
  canStartNotionWrite,
  remainingBaseSyncBudgetMs,
} from './sync-time-budget';

describe('sync time budget', () => {
  const options = {
    startedAt: 1_000,
    requestBudgetMs: 240_000,
    descriptionBudgetMs: 180_000,
    reserveForBaseSyncMs: 60_000,
  };

  it('stops optional description work before the base-sync reserve', () => {
    expect(canStartDescriptionExtraction({ ...options, now: () => 180_999 })).toBe(true);
    expect(canStartDescriptionExtraction({ ...options, now: () => 181_000 })).toBe(false);
  });

  it('uses the smaller explicit description budget when configured', () => {
    expect(
      canStartDescriptionExtraction({ ...options, descriptionBudgetMs: 90_000, now: () => 91_000 })
    ).toBe(false);
  });

  it('reports a non-negative remaining base-sync budget', () => {
    expect(
      remainingBaseSyncBudgetMs({ startedAt: 1_000, now: () => 101_000, requestBudgetMs: 240_000 })
    ).toBe(140_000);
    expect(
      remainingBaseSyncBudgetMs({ startedAt: 1_000, now: () => 300_000, requestBudgetMs: 240_000 })
    ).toBe(0);
  });

  it('does not start a Notion write when only response reserve remains', () => {
    expect(
      canStartNotionWrite({
        startedAt: 1_000,
        now: () => 231_000,
        requestBudgetMs: 240_000,
        reserveForResponseMs: 10_000,
      })
    ).toBe(false);
    expect(
      canStartNotionWrite({
        startedAt: 1_000,
        now: () => 231_000,
        requestBudgetMs: 240_000,
        reserveForResponseMs: 9_000,
      })
    ).toBe(true);
  });
});
