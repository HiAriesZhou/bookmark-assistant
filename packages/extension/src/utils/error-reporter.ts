import { cleanErrorReports } from '../core';
import { config } from '../background/config';
import { productConfig } from '../product-config';

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, any>;
  userAgent: string;
  version: string;
}

/**
 * Report error to server
 * Falls back gracefully if server is unreachable
 */
export async function reportError(error: Error, context?: Record<string, any>): Promise<void> {
  try {
    const manifest = chrome.runtime.getManifest();
    const report: ErrorReport = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      context: sanitizeContext(context),
      userAgent: navigator.userAgent,
      version: manifest.version,
    };

    // Store locally for user to view (optional)
    await storeLocalErrorReport(report);

    // Remote diagnostics intentionally exclude raw messages and stacks: they may contain
    // bookmark titles, URLs, OAuth parameters, or other personal workspace data.
    await sendToServer({
      ...report,
      message: getRemoteErrorCategory(error),
      stack: undefined,
      context: sanitizeRemoteContext(context),
    });
  } catch (err) {
    // Fail silently - don't break the app
    console.warn('[ErrorReporter] Failed to report error:', err);
  }
}

/**
 * Remove sensitive data from context
 */
function sanitizeContext(context?: Record<string, any>): Record<string, any> | undefined {
  if (!context) return undefined;

  const sanitized = { ...context };

  // Remove sensitive keys
  const sensitiveKeys = ['token', 'access_token', 'jwt', 'password', 'secret'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

function sanitizeRemoteContext(context?: Record<string, any>): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const safe: Record<string, unknown> = {};
  if (typeof context.operation === 'string') safe.operation = context.operation;
  if (typeof context.stage === 'string') safe.stage = context.stage;
  if (typeof context.type === 'string') safe.type = context.type;
  if (typeof context.bookmarkCount === 'number') safe.bookmarkCount = context.bookmarkCount;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function getRemoteErrorCategory(error: Error): string {
  const message = error.message.toLowerCase();
  const status = error.message.match(/status:\s*(\d{3})/i)?.[1];

  if (message.includes('server sync completed')) {
    return status ? `sync_partial_failure_notion_${status}` : 'sync_partial_failure';
  }
  if (message.includes('oauth') || message.includes('token')) return 'oauth_failure';
  if (message.includes('network') || message.includes('fetch failed')) return 'network_failure';
  return 'extension_error';
}

/**
 * Store error locally for debugging
 */
async function storeLocalErrorReport(report: ErrorReport): Promise<void> {
  try {
    const { error_reports = [] } = await chrome.storage.local.get('error_reports');

    // Add new error to the list
    const reports = [...error_reports, report];

    // Clean up old errors using retention policy (48h, max 10 errors)
    const cleanedReports = cleanErrorReports(reports);

    await chrome.storage.local.set({ error_reports: cleanedReports });
  } catch (err) {
    console.warn('[ErrorReporter] Failed to store error locally:', err);
  }
}

/**
 * Send error to server
 */
async function sendToServer(report: ErrorReport): Promise<void> {
  if (!productConfig.officialService) return;
  const serverUrl = config.notion.serverUrl;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`${serverUrl}/api/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[ErrorReporter] Server returned error:', response.status);
    }
  } catch (err) {
    // Network error or timeout - fail silently
    console.warn('[ErrorReporter] Failed to send error to server:', err);
  }
}

/**
 * Report a message (warning or info)
 */
export async function reportMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, any>
): Promise<void> {
  // For MVP, only log locally
  if (level === 'error') {
    await reportError(new Error(message), context);
  } else {
    console.log(`[${level.toUpperCase()}]`, message, context);
  }
}
