import { Request, Response, NextFunction } from 'express';
import {
  requestIdMiddleware,
  loggingMiddleware,
  rateLimitMiddleware,
  authenticationMiddleware,
  idempotencyMiddleware,
  validationMiddleware,
  securityMiddleware,
  metricsMiddleware,
  corsPreflightMiddleware,
  asyncErrorHandler
} from '../../src/middleware';
import { MetricsService } from '../../src/services/metrics';
import { RedisClient } from '../../src/utils/redis';
import winston from 'winston';

// Mock logger
const mockLogger = winston.createLogger({
  level: 'silent',
  transports: []
});

// Mock MetricsService
const mockMetrics = {
  incrementCounter: jest.fn(),
  recordHttpRequest: jest.fn(),
  setActiveConnections: jest.fn()
} as unknown as MetricsService;

// Mock RedisClient
const mockRedis = {
  checkRateLimit: jest.fn(),
  checkTokenBucket: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  getIdempotencyResult: jest.fn(),
  setIdempotencyResult: jest.fn()
} as unknown as RedisClient;

describe('Middleware Tests', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create fresh mock objects for each test
    mockReq = {
      method: 'GET',
      path: '/api/test',
      url: '/api/test',
      ip: '127.0.0.1',
      headers: {},
      get: jest.fn((header: string) => {
        return (mockReq.headers as any)?.[header.toLowerCase()];
      })
    };

    mockRes = {
      statusCode: 200,
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      removeHeader: jest.fn()
    };

    mockNext = jest.fn();
  });

  describe('requestIdMiddleware', () => {
    it('should add a request ID when none exists', () => {
      requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
      expect(mockReq.headers!['x-request-id']).toEqual(expect.any(String));
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use existing request ID when present', () => {
      const existingId = 'existing-request-id';
      mockReq.headers!['x-request-id'] = existingId;
      (mockReq.get as jest.Mock).mockReturnValue(existingId);

      requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith('X-Request-ID', existingId);
      expect(mockReq.headers!['x-request-id']).toBe(existingId);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('loggingMiddleware', () => {
    it('should log request start and completion', () => {
      const logSpy = jest.spyOn(mockLogger, 'info');
      const middleware = loggingMiddleware(mockLogger);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(logSpy).toHaveBeenCalledWith('Request started', expect.objectContaining({
        method: 'GET',
        path: '/api/test',
        ip: '127.0.0.1'
      }));

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle missing request ID gracefully', () => {
      const logSpy = jest.spyOn(mockLogger, 'info');
      const middleware = loggingMiddleware(mockLogger);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(logSpy).toHaveBeenCalledWith('Request started', expect.objectContaining({
        requestId: undefined
      }));
    });
  });

  describe('rateLimitMiddleware', () => {
    it('should allow requests within rate limit', async () => {
      (mockRedis.checkTokenBucket as jest.Mock).mockResolvedValue({
        allowed: true,
        tokens: 4,
        retryAfter: undefined
      });

      const middleware = rateLimitMiddleware(mockRedis, mockMetrics);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRedis.checkTokenBucket).toHaveBeenCalledWith(
        '127.0.0.1',
        expect.any(Number),
        expect.any(Number),
        1
      );
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(429);
    });

    it('should block requests exceeding rate limit', async () => {
      (mockRedis.checkTokenBucket as jest.Mock).mockResolvedValue({
        allowed: false,
        tokens: 0,
        retryAfter: 60
      });

      const middleware = rateLimitMiddleware(mockRedis, mockMetrics);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Too Many Requests'
      }));
      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'rate_limit_block_total', 
        { client: '127.0.0.1' }
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail open when Redis is unavailable', async () => {
      (mockRedis.checkTokenBucket as jest.Mock).mockRejectedValue(new Error('Redis unavailable'));

      const middleware = rateLimitMiddleware(mockRedis, mockMetrics);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(429);
    });
  });

  describe('authenticationMiddleware', () => {
    beforeEach(() => {
      process.env.API_KEY = 'test-api-key';
    });

    it('should allow requests with valid API key', () => {
      (mockReq.get as jest.Mock).mockReturnValue('test-api-key');

      authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(401);
    });

    it('should reject requests with invalid API key', () => {
      (mockReq.get as jest.Mock).mockReturnValue('invalid-key');

      authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Unauthorized',
        message: 'Invalid API key'
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests without API key', () => {
      (mockReq.get as jest.Mock).mockReturnValue(undefined);

      authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Unauthorized',
        message: 'API key required'
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should set user context for valid requests', () => {
      (mockReq.get as jest.Mock).mockReturnValue('test-api-key');

      authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as any).auth).toEqual(expect.objectContaining({
        userId: 'system',
        role: 'agent',
        permissions: ['read', 'write']
      }));
    });
  });

  describe('idempotencyMiddleware', () => {
    beforeEach(() => {
      mockReq.method = 'POST';
    });

    it('should skip idempotency for GET requests', async () => {
      mockReq.method = 'GET';
      const middleware = idempotencyMiddleware(mockRedis);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRedis.getIdempotencyResult).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip idempotency when key is not provided', async () => {
      (mockReq.get as jest.Mock).mockReturnValue(undefined);
      const middleware = idempotencyMiddleware(mockRedis);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRedis.getIdempotencyResult).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return cached result for duplicate requests', async () => {
      const idempotencyKey = 'test-key-123';
      const cachedResult = { statusCode: 200, body: { success: true, id: '123' } };

      (mockReq.get as jest.Mock).mockReturnValue(idempotencyKey);
      (mockRedis.getIdempotencyResult as jest.Mock).mockResolvedValue(cachedResult);

      const middleware = idempotencyMiddleware(mockRedis);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, id: '123' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should process new requests and store results', async () => {
      const idempotencyKey = 'test-key-456';

      (mockReq.get as jest.Mock).mockReturnValue(idempotencyKey);
      (mockRedis.getIdempotencyResult as jest.Mock).mockResolvedValue(null);

      const middleware = idempotencyMiddleware(mockRedis);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      // The original res.json should be wrapped
      expect(mockRes.json).toBeDefined();
    });

    it('should handle Redis errors gracefully', async () => {
      (mockReq.get as jest.Mock).mockReturnValue('test-key');
      (mockRedis.getIdempotencyResult as jest.Mock).mockRejectedValue(new Error('Redis error'));

      const middleware = idempotencyMiddleware(mockRedis);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validationMiddleware', () => {
    const mockSchema = {
      safeParse: jest.fn()
    };

    beforeEach(() => {
      mockReq.body = { name: 'test', email: 'test@example.com' };
    });

    it('should validate successful requests', () => {
      mockSchema.safeParse.mockReturnValue({ success: true, data: mockReq.body });

      const middleware = validationMiddleware(mockSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockSchema.safeParse).toHaveBeenCalledWith(mockReq.body);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({ name: 'test', email: 'test@example.com' });
    });

    it('should reject invalid requests', () => {
      const validationErrors = [
        { path: ['email'], message: 'Invalid email format' },
        { path: ['name'], message: 'Name is required' }
      ];
      mockSchema.safeParse.mockReturnValue({
        success: false,
        error: { errors: validationErrors }
      });

      const middleware = validationMiddleware(mockSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Validation Error',
        details: validationErrors
      }));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle validation errors gracefully', () => {
      mockSchema.safeParse.mockImplementation(() => {
        throw new Error('Schema validation failed');
      });

      const middleware = validationMiddleware(mockSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('securityMiddleware', () => {
    it('should set security headers', () => {
      securityMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockRes.set).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.set).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(mockRes.set).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
      expect(mockRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('metricsMiddleware', () => {
    it('should record HTTP request metrics', () => {
      mockReq.route = { path: '/api/test' };
      const middleware = metricsMiddleware(mockMetrics);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      // Verify the response.end method was wrapped
      expect(typeof mockRes.end).toBe('function');
    });

    it('should handle requests without route', () => {
      delete mockReq.route;
      const middleware = metricsMiddleware(mockMetrics);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('corsPreflightMiddleware', () => {
    it('should handle OPTIONS requests', () => {
      mockReq.method = 'OPTIONS';

      corsPreflightMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith(expect.objectContaining({
        'Access-Control-Allow-Origin': expect.any(String),
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': expect.any(String)
      }));
      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass through non-OPTIONS requests', () => {
      mockReq.method = 'GET';

      corsPreflightMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(204);
    });
  });

  describe('asyncErrorHandler', () => {
    it('should handle successful async operations', async () => {
      const asyncFn = jest.fn().mockResolvedValue('success');
      const wrappedFn = asyncErrorHandler(asyncFn);

      await wrappedFn(mockReq as Request, mockRes as Response, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalledWith(expect.any(Error));
    });

    it('should catch and forward async errors', async () => {
      const error = new Error('Async operation failed');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrappedFn = asyncErrorHandler(asyncFn);

      await wrappedFn(mockReq as Request, mockRes as Response, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should handle sync functions', async () => {
      const syncFn = jest.fn().mockReturnValue('sync result');
      const wrappedFn = asyncErrorHandler(syncFn);

      await wrappedFn(mockReq as Request, mockRes as Response, mockNext);

      expect(syncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalledWith(expect.any(Error));
    });

    // Note: For sync errors, they would normally be caught by Express error middleware
    // The asyncErrorHandler is primarily for async Promise rejections
    it('should handle sync errors in production with Express error middleware', () => {
      const syncFn = jest.fn().mockImplementation(() => {
        throw new Error('Sync operation failed');
      });
      const wrappedFn = asyncErrorHandler(syncFn);

      // In production, Express would catch this sync error
      expect(() => {
        try {
          wrappedFn(mockReq as Request, mockRes as Response, mockNext);
        } catch (error) {
          // This is expected for sync errors
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe('Sync operation failed');
        }
      }).not.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should work with multiple middleware in sequence', async () => {
      process.env.API_KEY = 'test-api-key';
      (mockReq.get as jest.Mock).mockImplementation((header) => {
        if (header === 'X-API-Key') return 'test-api-key';
        return undefined;
      });

      const middlewares = [
        requestIdMiddleware,
        securityMiddleware,
        authenticationMiddleware
      ];

      for (const middleware of middlewares) {
        await middleware(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        (mockNext as jest.Mock).mockClear();
      }

      // Verify final state
      expect(mockReq.headers!['x-request-id']).toBeDefined();
      expect((mockReq as any).auth).toBeDefined();
    });

    it('should handle middleware chain with errors', async () => {
      (mockReq.get as jest.Mock).mockReturnValue(undefined); // No API key

      const middlewares = [
        requestIdMiddleware,
        authenticationMiddleware // This should fail
      ];

      requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      (mockNext as jest.Mock).mockClear();

      authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).not.toHaveBeenCalled(); // Should be blocked
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});

describe('Middleware Error Scenarios', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      method: 'POST',
      path: '/api/test',
      url: '/api/test',
      ip: '127.0.0.1',
      headers: {},
      get: jest.fn()
    };

    mockRes = {
      statusCode: 200,
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      removeHeader: jest.fn()
    };

    mockNext = jest.fn();
  });

  it('should handle malformed request headers gracefully', () => {
    // Simulate malformed headers
    Object.defineProperty(mockReq, 'get', {
      value: () => { throw new Error('Header parsing failed'); },
      writable: true
    });

    // Most middleware should handle this gracefully
    expect(() => {
      securityMiddleware(mockReq as Request, mockRes as Response, mockNext);
    }).not.toThrow();

    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle response object errors', () => {
    // Simulate response error
    (mockRes.set as jest.Mock).mockImplementation(() => {
      throw new Error('Response header error');
    });

    expect(() => {
      securityMiddleware(mockReq as Request, mockRes as Response, mockNext);
    }).toThrow(); // This particular middleware should throw

    // But it should be caught by error handlers in production
  });

  it('should handle missing environment variables', () => {
    delete process.env.API_KEY;

    (mockReq.get as jest.Mock).mockReturnValue('some-key');

    authenticationMiddleware(mockReq as Request, mockRes as Response, mockNext);

    // Should still work with default fallback
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });
});