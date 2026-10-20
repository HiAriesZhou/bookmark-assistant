// 🔒 CORS and Rate Limiting Middleware

import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config';
import { auditLog } from '../utils';

import type { RequestHandler as RateLimitRequestHandler } from 'express';

// Pre-compiled regex cache to avoid ReDoS and improve performance
const regexCache = new Map<string, RegExp>();

/**
 * Get or create a compiled regex for the given wildcard pattern
 * Uses [^.]+ instead of .* to prevent catastrophic backtracking
 */
function getCompiledRegex(pattern: string): RegExp {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern)!;
  }

  // Convert wildcard pattern to regex
  // *.example.com -> regex: ^[^.]+\.example\.com$
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\\\*\\\*/g, '[^.]*') // ** -> [^.]* (zero or more, but not greedy)
    .replace(/\\\*/g, '[^.]+'); // * -> [^.]+ (one or more, not greedy)

  const regex = new RegExp(`^${regexPattern}$`);
  regexCache.set(pattern, regex);
  return regex;
}

/**
 * Check if origin is allowed based on allowed origins list
 * Supports exact matches and wildcard patterns like *.vercel.app
 */
function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  // Direct match
  if (allowedOrigins.includes(origin)) return true;

  // Wildcard pattern matching (e.g., *.vercel.app)
  for (const pattern of allowedOrigins) {
    if (pattern.includes('*')) {
      const regex = getCompiledRegex(pattern);
      if (regex.test(origin)) return true;
    }
  }

  return false;
}

/**
 * CORS configuration
 * Only allows requests from authorized origins
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Normalize origin
    const isChromeExt = origin.startsWith('chrome-extension://');

    // Check if origin is in allowed list (supports wildcards)
    const allowed = isOriginAllowed(origin, config.allowedOrigins);

    // In development, if the origin is a chrome extension and matches the configured extension ID, allow it
    if (isChromeExt) {
      const allowedChromeOrigins = config.allowedExtensionIds.map(
        (extensionId) => `chrome-extension://${extensionId}`
      );
      if (allowedChromeOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Additional dev-friendly allowance: any chrome-extension origin in development
      if (config.nodeEnv === 'development') {
        console.warn(
          `⚠️ Dev CORS: allowing chrome extension origin ${origin} (expected ${allowedChromeOrigins.join(', ') || 'none configured'})`
        );
        return callback(null, true);
      }
    }

    // In development, allow ngrok tunnels
    if (config.nodeEnv === 'development' && origin.endsWith('.ngrok-free.dev')) {
      return callback(null, true);
    }

    if (allowed) {
      return callback(null, true);
    }

    console.warn(`🚫 Blocked CORS request from: ${origin}`);
    auditLog('cors_blocked', 'unknown', { origin });
    return callback(new Error('Not allowed by CORS policy'));
  },
  credentials: true,
  optionsSuccessStatus: 200, // Support legacy browsers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Extension-ID', 'X-Requested-With'],
});

/**
 * Rate limiting for authentication endpoints
 * More restrictive to prevent brute force attacks
 */
export const authRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: config.rateLimits.auth.windowMs,
  max: config.rateLimits.auth.max,
  // @ts-expect-error - trustProxy is supported in express-rate-limit v7
  trustProxy: 1,
  message: {
    error: 'Too Many Requests',
    message: 'Too many authentication attempts, please try again later.',
    retryAfter: Math.ceil(config.rateLimits.auth.windowMs / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    auditLog('auth_rate_limit_exceeded', 'unknown', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: Math.ceil(config.rateLimits.auth.windowMs / 1000),
    });
  },
});

/**
 * Rate limiting for API endpoints
 * More generous for regular API usage
 */
export const apiRateLimit: RateLimitRequestHandler = rateLimit({
  windowMs: config.rateLimits.api.windowMs,
  max: config.rateLimits.api.max,
  // @ts-expect-error - trustProxy is supported in express-rate-limit v7
  trustProxy: 1,
  message: {
    error: 'Too Many Requests',
    message: 'Too many API requests, please try again later.',
    retryAfter: Math.ceil(config.rateLimits.api.windowMs / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    auditLog('api_rate_limit_exceeded', req.user?.userId || 'unknown', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many API requests, please try again later.',
      retryAfter: Math.ceil(config.rateLimits.api.windowMs / 1000),
    });
  },
});
