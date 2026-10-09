import { Router } from 'express';
import { config } from '../config';
import { paddlePricingService } from '../services';

const router: import('express').Router = Router();
const PRICING_RESPONSE_BUDGET_MS = 1_500;

/**
 * Pricing is optional extension chrome. A stalled commerce provider must never
 * hold the public endpoint long enough to block Options or service-worker
 * startup; callers receive the configured fallback instead.
 */
export function withinPricingResponseBudget<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Pricing provider exceeded ${PRICING_RESPONSE_BUDGET_MS}ms budget`)),
      PRICING_RESPONSE_BUDGET_MS
    );
  });
  return Promise.race([operation, budget]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

/**
 * GET /api/pricing
 * Public endpoint to get current pricing and limits
 * Used by extension to avoid hardcoding prices
 */
router.get('/', async (req, res) => {
  if (config.selfHosted)
    return res.status(404).json({ success: false, error: 'Commerce disabled' });
  try {
    // Fetch current pricing from Paddle (with caching)
    const pricing = await withinPricingResponseBudget(paddlePricingService.getPricing());

    res.json({
      success: true,
      pricing: {
        monthly: pricing.monthly,
        yearly: pricing.yearly,
        currencyCode: pricing.currencyCode,
        source: pricing.source,
      },
    });
  } catch (error) {
    console.error('❌ Failed to fetch pricing:', error);
    // Fallback to config defaults if Paddle fails
    res.json({
      success: true,
      pricing: {
        monthly: config.pricing.monthlyFallback,
        yearly: config.pricing.yearlyFallback,
        currencyCode: 'USD',
        source: 'configured-fallback',
      },
    });
  }
});

export default router;
