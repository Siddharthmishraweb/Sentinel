import { Application } from 'express';
import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';

// Import route modules
import { createIngestRouter } from './ingest';
import { createCustomerRouter } from './customer';
import { createInsightsRouter } from './insights';
import { triageRoutes } from './triage';
import { actionRoutes } from './action';
import { createKnowledgeBaseRouter } from './kb';
import { createAlertsRouter } from './alerts';
import { createTransactionsRouter } from './transactions';
import { createDashboardRouter } from './dashboard';
import { createEvaluationsRouter } from './evaluations';
import { createActionsRouter } from './actions';

interface RouteConfig {
  database: Database;
  redis: RedisClient;
  metrics: MetricsService;
  logger: Logger;
}

export const setupRoutes = (app: Application, config: RouteConfig): void => {
  const { database, redis, metrics, logger } = config;

  // API versioning
  const apiV1 = '/api/v1';

  // Register route modules
  app.use(`${apiV1}/ingest`, createIngestRouter(config));
  app.use(`${apiV1}/customers`, createCustomerRouter(config));
  app.use(`${apiV1}/insights`, createInsightsRouter(config));
  app.use(`${apiV1}/triage`, triageRoutes(config));
  app.use(`${apiV1}/action`, actionRoutes(config));
  app.use(`${apiV1}/kb`, createKnowledgeBaseRouter(config));
  app.use(`${apiV1}/alerts`, createAlertsRouter(config));
  app.use(`${apiV1}/transactions`, createTransactionsRouter(config));
  app.use(`${apiV1}/dashboard`, createDashboardRouter(config));
  app.use(`${apiV1}/evaluations`, createEvaluationsRouter(config));
  app.use(`${apiV1}/actions`, createActionsRouter(config));

  // Also mount without version for compatibility
  app.use('/api/ingest', createIngestRouter(config));
  app.use('/api/customers', createCustomerRouter(config));
  app.use('/api/insights', createInsightsRouter(config));
  app.use('/api/triage', triageRoutes(config));
  app.use('/api/action', actionRoutes(config));
  app.use('/api/kb', createKnowledgeBaseRouter(config));
  app.use('/api/alerts', createAlertsRouter(config));
  app.use('/api/transactions', createTransactionsRouter(config));
  app.use('/api/dashboard', createDashboardRouter(config));
  app.use('/api/evaluations', createEvaluationsRouter(config));
  app.use('/api/actions', createActionsRouter(config));

  logger.info('API routes registered successfully');
};

export { RouteConfig };