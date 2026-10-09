// 🛤️ Routes Index - Consolidated Route Exports

import { Router } from 'express';
import oauthRoutes from './oauth';
import notionRoutes from './notion';
import bookmarkRoutes from './bookmarks';
import userRoutes from './user';
import paddleRoutes from './paddle';
import pricingRoutes from './pricing';
import errorRoutes from './errors';
import aiRoutes from './ai';
import { PRODUCT_VERSION } from '../product-version.generated';

const router: import('express').Router = Router();

// Mount all route modules
router.use('/oauth', oauthRoutes);
router.use('/notion', notionRoutes);
router.use('/bookmarks', bookmarkRoutes);
router.use('/user', userRoutes);
router.use('/paddle', paddleRoutes); // Paddle routes: /api/paddle/checkout-url and /api/paddle/webhooks/paddle
router.use('/pricing', pricingRoutes);
router.use('/errors', errorRoutes); // Error reporting from extension
router.use('/ai', aiRoutes);

// Health check endpoint (kept at root level)
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: PRODUCT_VERSION,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Optional lightweight client log endpoint to capture non-critical client events (e.g., request timeouts)
router.post('/client-log', (req, res) => {
  try {
    if (req.body?.message !== 'REQUEST_TIMEOUT') return res.status(400).json({ success: false });
    const meta = req.body?.meta || {};
    const payload = {
      level: 'warn',
      message: 'REQUEST_TIMEOUT',
      meta: {
        endpointCategory:
          typeof meta.endpoint === 'string'
            ? /^\/api\/(oauth|notion|bookmarks|user|pricing|ai|paddle)(?:\/|$)/.exec(
                meta.endpoint
              )?.[1]
            : undefined,
        timeoutMs: typeof meta.timeoutMs === 'number' ? meta.timeoutMs : undefined,
      },
      at: new Date().toISOString(),
    };

    console.log('[CLIENT LOG]', JSON.stringify(payload));
    res.json({ success: true });
  } catch {
    res.status(400).json({ success: false });
  }
});

export default router;
