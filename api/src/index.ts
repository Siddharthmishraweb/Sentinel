import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { createLogger, transports, format } from 'winston';
import { Database } from './utils/database';
import { RedisClient } from './utils/redis';
import { setupMiddleware } from './middleware';
import { setupRoutes } from './routes';
import { MetricsService } from './services/metrics';
import { HealthService } from './services/health';

// Load environment variables
dotenv.config();

// Create logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

class SentinelServer {
  private app: express.Application;
  private server?: any;
  private database: Database;
  private redis: RedisClient;
  private metrics: MetricsService;
  private health: HealthService;

  constructor() {
    this.app = express();
    this.database = Database.getInstance();
    this.redis = RedisClient.getInstance();
    this.metrics = new MetricsService();
    this.health = new HealthService();
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Basic middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP on API server - frontend handles CSP
      crossOriginEmbedderPolicy: false
    }));

    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Idempotency-Key']
    }));

    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Custom middleware
    setupMiddleware(this.app, {
      database: this.database,
      redis: this.redis,
      metrics: this.metrics,
      logger
    });
  }

  private initializeRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      const healthStatus = await this.health.getStatus();
      const status = healthStatus.status === 'healthy' ? 200 : 503;
      res.status(status).json(healthStatus);
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.metrics.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain').send(metrics);
      } catch (error) {
        logger.error('Failed to get metrics', { error });
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    // API routes
    setupRoutes(this.app, {
      database: this.database,
      redis: this.redis,
      metrics: this.metrics,
      logger
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use('*', (req, res) => {
      logger.warn('Route not found', { 
        method: req.method, 
        path: req.originalUrl,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
      res.status(404).json({
        error: 'Route not found',
        message: `${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      const requestId = req.get('X-Request-ID') || 'unknown';
      
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        requestId,
        method: req.method,
        path: req.originalUrl,
        body: req.body,
        headers: req.headers
      });

      // Don't leak error details in production
      const isProduction = process.env.NODE_ENV === 'production';
      
      res.status(error.status || 500).json({
        error: isProduction ? 'Internal Server Error' : error.message,
        requestId,
        timestamp: new Date().toISOString(),
        ...(isProduction ? {} : { stack: error.stack })
      });
    });
  }

  public async start(): Promise<void> {
    const port = process.env.PORT || 3001;
    const host = process.env.HOST || '0.0.0.0';

    try {
      // Initialize services
      logger.info('Starting database migrations...');
      await this.database.runMigrations();
      logger.info('Database migrations completed');

      logger.info('Connecting to Redis...');
      await this.redis.connect();
      logger.info('Redis connected');

      // Start metrics collection
      logger.info('Starting metrics collection...');
      this.metrics.startCollection();
      logger.info('Metrics collection started');

      // Start server
      logger.info('Starting HTTP server...');
      const portNumber = typeof port === 'string' ? parseInt(port, 10) : port;
      this.server = this.app.listen(portNumber, host, () => {
        logger.info(`Server started on ${host}:${portNumber}`, {
          environment: process.env.NODE_ENV,
          version: process.env.npm_package_version
        });
      });

      // Handle server errors
      this.server.on('error', (error: any) => {
        logger.error('Server error', { error });
        throw error;
      });

      // Graceful shutdown handling
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('Failed to start server', { error });
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown`);

      if (this.server) {
        this.server.close(async () => {
          logger.info('HTTP server closed');

          try {
            await this.redis.disconnect();
            logger.info('Redis disconnected');

            await this.database.close();
            logger.info('Database disconnected');

            this.metrics.stopCollection();
            logger.info('Metrics collection stopped');

            process.exit(0);
          } catch (error) {
            logger.error('Error during shutdown', { error });
            process.exit(1);
          }
        });

        // Force close after timeout
        setTimeout(() => {
          logger.error('Could not close connections in time, forcefully shutting down');
          process.exit(1);
        }, 10000);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      shutdown('unhandledRejection');
    });
  }

  public getApp(): express.Application {
    return this.app;
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new SentinelServer();
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { SentinelServer };
export default SentinelServer;