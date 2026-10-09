import { describe, expect, it } from 'vitest';
import { parsePublicPricing } from './server-api';

describe('public pricing response', () => {
  it('accepts finite monthly and yearly recurring prices', () => {
    expect(
      parsePublicPricing({
        monthly: 1.5,
        yearly: 11.9,
        currencyCode: 'USD',
        source: 'paddle',
      })
    ).toEqual({
      monthly: 1.5,
      yearly: 11.9,
      currencyCode: 'USD',
      source: 'paddle',
    });
  });

  it('rejects the retired lifetime response instead of rendering an invalid yearly price', () => {
    expect(
      parsePublicPricing({
        monthly: 1.5,
        lifetime: 11.9,
        currencyCode: 'USD',
        source: 'paddle',
      })
    ).toBeNull();
  });
});
