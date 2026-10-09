// 🔧 Middleware Index - Consolidated Middleware Exports

export {
  validateExtension,
  validateSession,
  requestLogger,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from './auth';

export { corsMiddleware, authRateLimit, apiRateLimit, createRateLimit } from './security';
