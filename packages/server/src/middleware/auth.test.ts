/**
 * Unit tests for authentication middleware
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  validateExtension,
  validateSession,
  requestLogger,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from './auth';

import { config } from '../config';
import { auditLog } from '../utils';

// Mock config
vi.mock('../config', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    allowedExtensionId: 'test-extension-id',
    allowedExtensionIds: ['test-extension-id', 'secondary-extension-id'],
    nodeEnv: 'development',
  },
}));

// Mock utils
vi.mock('../utils', () => ({
  auditLog: vi.fn(),
}));

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    config.nodeEnv = 'development';
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    nextFunction = vi.fn();
  });

  describe('validateExtension', () => {
    it('should allow request with valid extension ID', () => {
      mockRequest.headers = {
        'x-extension-id': 'test-extension-id',
      };

      validateExtension(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should allow request with any configured extension ID', () => {
      mockRequest.headers = {
        'x-extension-id': 'secondary-extension-id',
      };

      validateExtension(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject request with missing extension ID', () => {
      mockRequest.headers = {};

      validateExtension(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Invalid extension identity',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with invalid extension ID', () => {
      mockRequest.headers = {
        'x-extension-id': 'invalid-extension-id',
      };

      validateExtension(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Invalid extension identity',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should log audit event on validation failure', () => {
      mockRequest.headers = {
        'x-extension-id': 'invalid',
      };

      validateExtension(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });
  });

  describe('validateSession', () => {
    const validToken = jwt.sign(
      { userId: 'user-123', email: 'test@example.com' },
      'test-jwt-secret'
    );

    it('should allow request with valid JWT token', () => {
      mockRequest.headers = {
        authorization: `Bearer ${validToken}`,
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should reject request with missing Authorization header', () => {
      mockRequest.headers = {};

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Session token required',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token format', () => {
      mockRequest.headers = {
        authorization: 'InvalidFormat token',
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Malformed session token',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with expired token', () => {
      const expiredToken = jwt.sign(
        { userId: 'user-123' },
        'test-jwt-secret',
        { expiresIn: -1 } // Expired
      );

      mockRequest.headers = {
        authorization: `Bearer ${expiredToken}`,
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Session token expired',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with malformed JWT', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid.jwt.token',
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Malformed session token',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with wrong secret', () => {
      const wrongSecretToken = jwt.sign({ userId: 'user-123' }, 'wrong-secret');

      mockRequest.headers = {
        authorization: `Bearer ${wrongSecretToken}`,
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid session token',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should attach user data to request on success', () => {
      mockRequest.headers = {
        authorization: `Bearer ${validToken}`,
      };

      validateSession(mockRequest as any, mockResponse as Response, nextFunction);

      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user?.userId).toBe('user-123');
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('requestLogger', () => {
    it('should log request and response', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockRequest.method = 'GET';
      mockRequest.url = '/test?code=private-oauth-code';
      mockRequest.path = '/test';
      mockRequest.ip = '127.0.0.1';
      mockRequest.headers = {
        'user-agent': 'test-agent',
      };
      mockResponse.statusCode = 200;

      requestLogger(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(consoleSpy).toHaveBeenCalledWith('📥 GET /test');
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('private-oauth-code');

      // Simulate response end
      mockResponse.end!();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^📤 GET \/test - 200 - \d+ms$/)
      );

      consoleSpy.mockRestore();
    });

    it('should call next function', () => {
      requestLogger(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('errorHandler', () => {
    it('should return error message in development', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Test error',
        stack: error.stack,
      });
    });

    it('delegates to Express when the response has already started', () => {
      const error = new Error('Late failure');
      const response = { ...mockResponse, headersSent: true } as Response;

      errorHandler(error, mockRequest as Request, response, nextFunction);

      expect(nextFunction).toHaveBeenCalledWith(error);
      expect(auditLog).toHaveBeenCalledWith(
        'server_error',
        'unknown',
        expect.objectContaining({ error: 'Late failure' })
      );
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    });

    it('should hide error details in production', () => {
      config.nodeEnv = 'production';

      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
      expect(mockResponse.json).not.toHaveBeenCalledWith(
        expect.objectContaining({ stack: expect.any(String) })
      );
    });

    it('should log error with user context', () => {
      const error = new Error('Test error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRequest.user = { userId: 'user-123' };

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);

      expect(console.error).toHaveBeenCalledWith('🚨 Server Error:', error);
      consoleSpy.mockRestore();
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with available endpoints', () => {
      mockRequest.method = 'GET';
      mockRequest.url = '/nonexistent';
      mockRequest.ip = '127.0.0.1';
      mockRequest.user = { userId: 'user-123' };

      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Endpoint not found',
        availableEndpoints: expect.arrayContaining([
          'GET /health',
          'POST /oauth/exchange',
          'POST /bookmarks/sync',
        ]),
      });
    });
  });

  describe('securityHeaders', () => {
    it('should add security headers to response', () => {
      securityHeaders(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Response-Time', expect.any(String));
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should call next function', () => {
      securityHeaders(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });
});
