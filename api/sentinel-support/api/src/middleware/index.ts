import { Application, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';

interface MiddlewareConfig {
  database: Database;
  redis: RedisClient;
  metrics: MetricsService;
  logger: Logger;
}

// Request ID middleware
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = req.get('X-Request-ID') || uuidv4();
  req.headers['x-request-id'] = requestId;
  res.set('X-Request-ID', requestId);
  next();
};

// Logging middleware
export const loggingMiddleware = (logger: Logger) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const requestId = req.get('X-Request-ID');

    // Log request
    logger.info('Request started', {
      requestId,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Override res.end to capture response
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
      const duration = Date.now() - start;
      // Basic PAN detection in body/query (13-19 consecutive digits)
      let masked = false;
      try {
        const rawContent = JSON.stringify({ body: req.body, query: req.query }).slice(0, 8000);
        masked = /\b\d{13,19}\b/.test(rawContent);
      } catch { /* ignore */ }

      logger.info('Request completed', {
        requestId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        masked
      });

      // Call original end and return the result
      return originalEnd.call(this, chunk, encoding, cb);
    };

    next();
  };
};

// Rate limiting middleware with Redis
export const rateLimitMiddleware = (redis: RedisClient, metrics: MetricsService) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientId = req.ip || 'unknown';
    // Enforce 5 requests per second baseline
    const requestsPerSecond = parseInt(process.env.RATE_LIMIT_RPS || '5');
    const windowSec = 1;
    const burstMax = parseInt(process.env.RATE_LIMIT_BURST_MAX || '5');

    try {
      const result = await redis.checkTokenBucket(
        clientId,
        burstMax,
        requestsPerSecond,
        1
      );

      const resetTs = Date.now() + 1000; // Next second
      res.set('X-Rate-Limit-Limit', requestsPerSecond.toString());
      res.set('X-Rate-Limit-Window', `${windowSec}s`);
      res.set('X-Rate-Limit-Reset', resetTs.toString());

      if (!result.allowed) {
        metrics.incrementCounter('rate_limit_block_total', { client: clientId });
        res.set('Retry-After', '1');
        res.set('X-Rate-Limit-Remaining', '0');
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: 1,
          timestamp: new Date().toISOString()
        });
      }

      res.set('X-Rate-Limit-Remaining', result.tokens.toString());
      next();
    } catch (error) {
      // Fail open on Redis errors
      next();
    }
  };
};

// Authentication middleware
export const authenticationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.get('X-API-Key') || req.query.apiKey;
  const expectedApiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'API key required', timestamp: new Date().toISOString() });
  }
  if (apiKey !== expectedApiKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key', timestamp: new Date().toISOString() });
  }

  // Determine role from header (X-User-Role) or default to agent. Accepts 'agent' | 'lead'
  const roleHeader = (req.get('X-User-Role') || '').toLowerCase();
  const role = roleHeader === 'lead' ? 'lead' : 'agent';

  // Permissions mapping
  const permissions = role === 'lead'
    ? ['read', 'write', 'force_approve', 'bypass_otp']
    : ['read', 'write'];

  (req as any).auth = {
    userId: req.get('X-User-Id') || 'system',
    role,
    permissions,
    sessionId: req.get('X-Request-ID'),
  };
  next();
};

// RBAC enforcement helper
export const requireRole = (role: 'lead' | 'agent') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth;
    if (!auth || (auth.role !== role && role === 'lead')) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient role privileges', timestamp: new Date().toISOString() });
    }
    next();
  };
};

// Idempotency middleware
export const idempotencyMiddleware = (redis: RedisClient) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const idempotencyKey = req.get('Idempotency-Key');
    
    if (!idempotencyKey || req.method === 'GET') {
      return next();
    }

    try {
      const cachedResult = await redis.getIdempotencyResult(idempotencyKey);
      
      if (cachedResult) {
        return res.status(cachedResult.statusCode).json(cachedResult.body);
      }

      // Store original res.json to capture response
      const originalJson = res.json;
      res.json = function(body: any) {
        // Cache the result
        redis.setIdempotencyResult(idempotencyKey, {
          statusCode: res.statusCode,
          body
        });

        return originalJson.call(this, body);
      };

      next();
    } catch (error) {
      // Continue without idempotency on Redis errors
      next();
    }
  };
};

// Validation middleware
export const validationMiddleware = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Request body validation failed',
          details: result.error.errors,
          timestamp: new Date().toISOString()
        });
      }

      req.body = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Security headers middleware
export const securityMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Additional security headers beyond helmet
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

// Metrics collection middleware
export const metricsMiddleware = (metrics: MetricsService) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const route = req.route?.path || req.path;

    // Override res.end to capture metrics
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
      const duration = Date.now() - start;
      
      // Record request metrics
      metrics.recordHttpRequest(req.method, route, res.statusCode, duration);
      
      return originalEnd.call(this, chunk, encoding, cb);
    };

    next();
  };
};

// Error handling middleware
export const asyncErrorHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// CORS preflight handler
export const corsPreflightMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://localhost:3002',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key,Idempotency-Key,X-Request-ID',
      'Access-Control-Max-Age': '86400'
    });
    return res.status(204).send();
  }
  next();
};

// Setup all middleware
export const setupMiddleware = (app: Application, config: MiddlewareConfig) => {
  const { database, redis, metrics, logger } = config;

  // Request tracking
  app.use(requestIdMiddleware);
  app.use(loggingMiddleware(logger));
  app.use(metricsMiddleware(metrics));

  // Security
  app.use(securityMiddleware);
  app.use(corsPreflightMiddleware);

  // Rate limiting (apply to API routes only)
  app.use('/api', rateLimitMiddleware(redis, metrics));

  // Idempotency (apply to mutation endpoints)
  app.use(['/api/ingest', '/api/action', '/api/triage'], idempotencyMiddleware(redis));

  // Authentication (apply to protected routes)
  app.use('/api', authenticationMiddleware);
};

// All exports are already done with individual export statements