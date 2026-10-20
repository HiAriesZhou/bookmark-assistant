// 🛡️ Security and Authentication Middleware

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../types';
import { config } from '../config';
import { auditLog } from '../utils';

/**
 * Extension validation middleware
 * Ensures requests come from the authorized Chrome extension
 */
export const validateExtension = (req: Request, res: Response, next: NextFunction) => {
  const extensionId = req.headers['x-extension-id'] as string;

  if (!extensionId || !config.allowedExtensionIds.includes(extensionId)) {
    auditLog('extension_validation_failed', 'unknown', {
      providedId: extensionId,
      expectedIds: config.allowedExtensionIds,
    });

    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid extension identity',
    });
  }

  next();
};

/**
 * JWT session validation middleware
 * Validates and decodes JWT tokens from Authorization header
 */
export const validateSession = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Session token required',
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    const { iat: _iat, exp: _exp, nbf: _nbf, ...user } = decoded;
    req.user = user;
    next();
  } catch (error) {
    let errorMessage = 'Invalid session token';

    if (error instanceof jwt.TokenExpiredError) {
      errorMessage = 'Session token expired';
    } else if (error instanceof jwt.JsonWebTokenError) {
      if (error.message === 'invalid signature') {
        errorMessage = 'Invalid session token';
      } else {
        errorMessage = 'Malformed session token';
      }
    }

    auditLog('session_validation_failed', req.user?.userId || 'unknown', {
      error: errorMessage,
      tokenProvided: !!token,
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: errorMessage,
    });
  }
};

/**
 * Request logging middleware
 * Logs all incoming requests for audit purposes
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  // OAuth codes, URLs and credentials may occur in query parameters. Log paths only.
  const { method, path: url } = req;

  // Log request start
  console.log(`📥 ${method} ${url}`);

  // Override res.end to log response
  const originalEnd = res.end.bind(res);
  res.end = function (chunk?: any, encoding?: BufferEncoding | (() => void), cb?: () => void) {
    const duration = Date.now() - start;
    console.log(`📤 ${method} ${url} - ${res.statusCode} - ${duration}ms`);

    // Handle different call signatures of res.end()
    if (typeof encoding === 'function') {
      return originalEnd(chunk, encoding);
    } else {
      return originalEnd(chunk, encoding || 'utf8', cb);
    }
  };

  next();
};

/**
 * Error handling middleware
 * Catches and formats errors consistently
 */
export const errorHandler = (error: Error, req: Request, res: Response, next: NextFunction) => {
  // A response that already started cannot be replaced; Express closes it.
  if (res.headersSent) return next(error);

  console.error('🚨 Server Error:', error);

  auditLog('server_error', req.user?.userId || 'unknown', {
    error: error.message,
    stack: error.stack,
    url: req.path,
    method: req.method,
  });

  // Don't expose internal errors in production
  const isDevelopment = config.nodeEnv === 'development';

  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    ...(isDevelopment && { stack: error.stack }),
  });
};

/**
 * 404 Not Found middleware
 * Handles routes that don't exist
 */
export const notFoundHandler = (req: Request, res: Response) => {
  auditLog('route_not_found', req.user?.userId || 'unknown', {
    method: req.method,
    url: req.path,
    ip: req.ip,
  });

  res.status(404).json({
    error: 'Not Found',
    message: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /oauth/exchange',
      'POST /oauth/refresh',
      'POST /notion/query-database',
      'POST /bookmarks/sync',
      'GET /notion/databases',
      'GET /user/profile',
      'POST /bookmarks/sync',
      'POST /template/duplicate',
      'POST /notion/create-page',
    ],
  });
};

/**
 * Security headers middleware
 * Adds security-related headers to responses
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Additional security headers beyond helmet
  res.setHeader('X-Request-ID', Math.random().toString(36).substring(7));
  res.setHeader('X-Response-Time', Date.now().toString());

  next();
};
