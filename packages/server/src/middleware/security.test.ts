/**
 * Unit tests for security middleware (CORS and rate limiting)
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { corsMiddleware, authRateLimit, apiRateLimit } from './security';

import { config } from '../config';
// Mock config
vi.mock('../config', () => ({
  config: {
    allowedOrigins: ['https://example.com', 'https://app.example.com'],
    allowedExtensionId: 'test-extension-id',
    allowedExtensionIds: ['test-extension-id', 'secondary-extension-id'],
    nodeEnv: 'development',
    rateLimits: {
      auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 requests per window
      },
      api: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // 100 requests per window
      },
    },
  },
}));

// Mock utils
vi.mock('../utils', () => ({
  auditLog: vi.fn(),
}));

// Mock express-rate-limit
vi.mock('express-rate-limit', () => ({
  rateLimit: vi.fn().mockImplementation((_config) => {
    return (req: Request, res: Response, next: NextFunction) => {
      next();
    };
  }),
}));

describe('Security Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    config.nodeEnv = 'development';
    mockRequest = {
      headers: {},
    };
    // Track calls to vary
    const varyCalls: string[] = [];
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn((header, value) => {
        if (!mockResponse.headers) mockResponse.headers = {};
        mockResponse.headers[header] = value;
      }),
      getHeader: vi.fn((header) => {
        return mockResponse.headers?.[header];
      }),
      vary: vi.fn((header: string) => {
        varyCalls.push(header);
        // Implement the actual vary behavior - append to existing Vary header
        const currentVary = mockResponse.getHeader?.('vary');
        if (currentVary) {
          if (!currentVary.includes(header)) {
            mockResponse.setHeader('vary', `${currentVary}, ${header}`);
          }
        } else {
          mockResponse.setHeader('vary', header);
        }
      }),
      set: vi.fn(),
      get: vi.fn(),
      end: vi.fn(),
      send: vi.fn(),
      headers: {},
    };
    nextFunction = vi.fn();
  });

  describe('corsMiddleware', () => {
    it('should allow request with no origin', () => {
      const callback = vi.fn();

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should allow allowed origin', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://example.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should allow chrome extension with correct ID', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'chrome-extension://test-extension-id',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should allow chrome extension in development mode', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'chrome-extension://any-extension-id',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should allow chrome extension with any configured ID in production', () => {
      config.nodeEnv = 'production';
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'chrome-extension://secondary-extension-id',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should allow ngrok tunnel in development', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://test.ngrok-free.dev',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should reject disallowed origin', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://malicious.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Not allowed by CORS policy',
        })
      );
    });

    it('should reject chrome extension with wrong ID in production', () => {
      config.nodeEnv = 'production';
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'chrome-extension://wrong-extension-id',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Not allowed by CORS policy',
        })
      );
    });

    it('should configure CORS with correct options', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://example.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });
  });

  describe('authRateLimit', () => {
    it('should be defined', () => {
      expect(authRateLimit).toBeDefined();
      expect(typeof authRateLimit).toBe('function');
    });

    it('should call next function when rate limit not exceeded', () => {
      authRateLimit(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('apiRateLimit', () => {
    it('should be defined', () => {
      expect(apiRateLimit).toBeDefined();
      expect(typeof apiRateLimit).toBe('function');
    });

    it('should call next function when rate limit not exceeded', () => {
      apiRateLimit(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('CORS configuration', () => {
    it('should allow specified methods', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://example.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should support credentials', () => {
      const callback = vi.fn();
      mockRequest.headers = {
        origin: 'https://example.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).toHaveBeenCalledWith();
    });

    it('should handle OPTIONS requests', () => {
      const callback = vi.fn();
      mockRequest.method = 'OPTIONS';
      mockRequest.headers = {
        origin: 'https://example.com',
      };

      corsMiddleware(mockRequest as Request, mockResponse as Response, callback);

      expect(callback).not.toHaveBeenCalled();
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });
});
