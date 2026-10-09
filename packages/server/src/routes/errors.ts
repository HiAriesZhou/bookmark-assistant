import express, { Request, Response, Router } from 'express';

const router: Router = express.Router();

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, any>;
  userAgent: string;
  version?: string;
}

function sanitizeRemoteContext(
  context: Record<string, any> | undefined
): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const safe: Record<string, unknown> = {};
  if (typeof context.operation === 'string') safe.operation = context.operation;
  if (typeof context.stage === 'string') safe.stage = context.stage;
  if (typeof context.type === 'string') safe.type = context.type;
  if (typeof context.bookmarkCount === 'number') safe.bookmarkCount = context.bookmarkCount;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function classifyErrorCategory(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('sync')) return 'sync_failure';
  if (normalized.includes('oauth') || normalized.includes('token')) return 'oauth_failure';
  if (normalized.includes('network') || normalized.includes('fetch')) return 'network_failure';
  return 'extension_error';
}

/**
 * POST /api/errors
 * Collect errors from extension
 *
 * This endpoint receives error reports from the Chrome extension
 * and logs them to Vercel logs (free, searchable, 90-day retention)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const report: ErrorReport = req.body;

    // Validate payload
    if (!report.message || !report.timestamp) {
      return res.status(400).json({ error: 'Invalid error report' });
    }

    // Do not persist raw extension errors. Older clients can include bookmark names,
    // URLs and OAuth details in their messages or stacks.
    console.error('[Extension Error]', {
      category: classifyErrorCategory(report.message),
      timestamp: report.timestamp,
      version: report.version || 'unknown',
      context: sanitizeRemoteContext(report.context),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to process error report:', error);
    res.status(500).json({ error: 'Failed to process error report' });
  }
});

export default router;
