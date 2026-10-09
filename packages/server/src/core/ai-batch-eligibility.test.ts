import { describe, expect, it } from 'vitest';
import { isBatchAiEligibleCapture } from './ai-batch-eligibility';

describe('isBatchAiEligibleCapture', () => {
  it('allows bulk Chrome sources', () => {
    expect(
      isBatchAiEligibleCapture(true, [{ source: 'chrome_bookmark' }, { source: 'reading_list' }])
    ).toBe(true);
  });

  it.each(['current_page', 'context_menu'] as const)(
    'rejects %s captures even when requested',
    (source) => {
      expect(isBatchAiEligibleCapture(true, [{ source }])).toBe(false);
    }
  );

  it('honors a client opt-out', () => {
    expect(isBatchAiEligibleCapture(false, [{ source: 'chrome_bookmark' }])).toBe(false);
  });
});
