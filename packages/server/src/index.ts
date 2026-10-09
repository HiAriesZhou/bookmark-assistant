// 🔐 Secure OAuth Token Exchange Server
// This server handles OAuth flows for the Bookmark Notion Sync Chrome extension

import express from 'express';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import routes from './routes';
import {
  corsMiddleware,
  authRateLimit,
  apiRateLimit,
  requestLogger,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from './middleware';
import { auditLog, logger } from './utils';
import {
  cleanupExpiredDescriptionsOpportunistically,
  scheduleCleanupJob,
} from './jobs/cache-cleanup';
import { scheduleAiDiagnosticCleanup } from './jobs/ai-diagnostic-cleanup';
import { PRODUCT_VERSION } from './product-version.generated';

// Validate configuration before starting
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const app: import('express').Application = express();
const PORT = config.port;

// Trust proxy for accurate IP detection behind Vercel
app.set('trust proxy', 1);

// 🛡️ Security middleware
app.use(helmet());
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));

// CORS configuration
app.use(corsMiddleware);

// Request logging
app.use(requestLogger);

// Rate limiting
app.use('/api/oauth', authRateLimit);
app.use('/api/notion', apiRateLimit);
app.use('/api/bookmarks', apiRateLimit);
app.use('/api/user', apiRateLimit);
app.use('/api/ai', apiRateLimit);
app.use('/api/client-log', apiRateLimit);
app.use('/api/paddle/checkout-url', apiRateLimit);

// Mount all routes under /api prefix
app.use('/api', routes);

// Error handling middleware (must be last)
app.use(errorHandler);
app.use('*', notFoundHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// 🎯 Start server (only when not running on Vercel serverless)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    logger.info(`Bookmark Notion Sync Server running on port ${PORT}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(
      `Log file: ${process.env.LOG_DIR || '/tmp'}/server-${new Date().toISOString().split('T')[0]}.log`
    );

    // Schedule cache cleanup job
    scheduleCleanupJob();
    scheduleAiDiagnosticCleanup();

    auditLog('server_start', 'system', {
      port: PORT,
      environment: config.nodeEnv,
      allowedExtensionIds: config.allowedExtensionIds,
      version: PRODUCT_VERSION,
    });
  });
}

// Vercel serverless handler: delegate requests to Express app
export default function handler(req: any, res: any) {
  // AI runs are database-intensive and latency-sensitive. Cleanup remains
  // opportunistic on ordinary requests without competing for this small pool.
  if (!String(req.url || '').startsWith('/api/ai/')) {
    void cleanupExpiredDescriptionsOpportunistically();
  }
  return (app as any)(req, res);
}
