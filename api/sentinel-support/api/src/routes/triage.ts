import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { MultiAgentOrchestrator } from '../agents/orchestrator';
import { RedactorAgent } from '../agents/redactor';

interface RouteConfig {
  database: Database;
  redis: RedisClient;
  metrics: MetricsService;
  logger: Logger;
}

export const triageRoutes = (config: RouteConfig): Router => {
  const router = Router();
  const { database, redis, metrics, logger } = config;
  const orchestrator = new MultiAgentOrchestrator(redis, logger, database, metrics);

  // Start a triage run
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    let statusCode = 200;
    try {
      const { alertId, customerId, transactionId } = req.body;

      if (!alertId || !customerId) {
        statusCode = 400;
        res.status(statusCode).json({
          error: 'Missing required fields: alertId, customerId'
        });
        return;
      }

      logger.info('Starting triage', { alertId, customerId, transactionId });

      // Start the triage process
      const runId = await orchestrator.startTriage(alertId, customerId, transactionId);

      // Record metrics
      metrics.incrementCounter('triage_started_total', { alert_id: alertId });

      res.json({
        runId,
        id: runId, // compatibility for clients expecting `id`
        alertId,
        status: 'STARTED',
        timestamp: Date.now()
      });

    } catch (error: any) {
      statusCode = 500;
      logger.error('Failed to start triage', { error: error?.message });
      res.status(statusCode).json({
        error: 'Failed to start triage',
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('POST', '/triage', statusCode, Date.now() - startTime);
    }
  });

  // Get triage results
  router.get('/:runId', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    let statusCode = 200;
    try {
      const { runId } = req.params;

      const resultsJson = await redis.get(`triage:${runId}:results`);
      if (!resultsJson) {
        statusCode = 404;
        res.status(statusCode).json({ error: 'Triage results not found', runId });
        return;
      }

      // redis.get returns unknown/any; ensure string before parsing
      const raw = typeof resultsJson === 'string' ? resultsJson : JSON.stringify(resultsJson);
      let results: any;
      try {
        results = JSON.parse(raw);
      } catch (e) {
        logger.warn('Failed to parse triage results JSON, returning raw', { runId });
        results = raw;
      }
      const { data: redactedResults, masked } = RedactorAgent.redactForUI(results);

      if (masked) {
        logger.info('Redacted PII from triage results', { runId, masked: true });
      }

      res.json({
        runId,
        ...redactedResults,
        redacted: masked
      });

    } catch (error: any) {
      statusCode = 500;
      logger.error('Failed to get triage results', { error: error?.message });
      res.status(statusCode).json({
        error: 'Failed to get triage results',
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('GET', '/triage/:runId', statusCode, Date.now() - startTime);
    }
  });

  // Polling endpoint for triage status
  router.get('/:runId/status', async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params;
    const startTime = Date.now();
    
    try {
      logger.info('Getting triage status', { runId });

      // Get events from orchestrator
      const events = await orchestrator.getEvents(runId);
      
      if (!events || events.length === 0) {
        res.status(404).json({
          error: 'Triage run not found',
          runId
        });
        return;
      }

      // Check if triage is complete
      const hasDecision = events.some((e: any) => e.type === 'decision_finalized');
      const hasError = events.some((e: any) => e.type === 'error');
      
      let status = 'running';
      if (hasDecision) status = 'completed';
      if (hasError) status = 'error';

      res.json({
        runId,
        status,
        events,
        timestamp: Date.now()
      });

    } catch (error: any) {
      logger.error('Failed to get triage status', { runId, error: error?.message });
      
      res.status(500).json({
        error: 'Failed to get triage status',
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('GET', '/triage/status', 200, Date.now() - startTime);
    }
  });

  // Server-Sent Events stream for triage updates
  router.get('/:runId/stream', async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.params;
    
    logger.info('Starting triage stream', { runId });

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Set client reconnection delay and initial event
    res.write(`retry: 1500\\n`); // Suggest 1.5s retry
    res.write(`id: ${Date.now()}\\n`);
    res.write(`event: connected\\n`);
    res.write(`data: ${JSON.stringify({ runId, timestamp: Date.now(), type: 'connected' })}\\n\\n`);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\\n\\n`); // Comment line keeps connection alive
    }, 10000);

    let lastEventCount = 0;
    let pollInterval: NodeJS.Timeout;

    const sendEvents = async () => {
      try {
        const events = await orchestrator.getEvents(runId);
        
        // Send only new events
        const newEvents = events.slice(lastEventCount);
        
        for (const event of newEvents) {
          // Redact any PII in event data
          const { data: redactedEvent, masked } = RedactorAgent.redactForUI(event);
          
          if (masked) {
            logger.info('Redacted PII from triage event', { runId, eventType: event.type, masked: true });
          }

          res.write(`id: ${Date.now()}\\n`);
          res.write(`event: ${event.type}\\n`);
          res.write(`data: ${JSON.stringify(redactedEvent)}\\n\\n`);
        }
        
        lastEventCount = events.length;
        
        // Check if triage is complete
        const hasDecision = events.some(e => e.type === 'decision_finalized' || e.type === 'error');
        
        if (hasDecision) {
          res.write(`id: ${Date.now()}\\n`);
          res.write(`event: stream_complete\\n`);
          res.write(`data: ${JSON.stringify({ runId, timestamp: Date.now(), type: 'stream_complete' })}\\n\\n`);
          
          logger.info('Triage stream completing normally', { runId });
          res.end();
          if (pollInterval) clearTimeout(pollInterval);
          return;
        }
        
      } catch (error: any) {
        logger.error('Error in triage stream', { runId, error: error?.message });
        
        res.write(`id: ${Date.now()}\\n`);
        res.write(`event: error\\n`);
        res.write(`data: ${JSON.stringify({ error: 'Stream error', timestamp: Date.now(), type: 'error' })}\\n\\n`);
        
        res.end();
        if (pollInterval) clearTimeout(pollInterval);
      }
    };

    // Determine polling strategy
    const requestedInterval = parseInt((req.query.interval as string) || '0', 10);
    const baseFastInterval = 250; // faster early polling
    const baseSlowInterval = 1000; // default steady interval
    let currentInterval = requestedInterval > 0 ? requestedInterval : baseFastInterval;
    let switches = 0;

    const scheduleNext = () => {
      pollInterval = setTimeout(async () => {
        await sendEvents();
        // After first 2 polls without completion, slow down
        if (requestedInterval === 0 && switches < 1) {
          switches++;
          currentInterval = baseSlowInterval;
        }
        if (!res.writableEnded) scheduleNext();
      }, currentInterval);
    };

    // Initial immediate send then schedule
    await sendEvents();
    scheduleNext();

    // Handle client disconnect
    req.on('close', () => {
      logger.info('Triage stream client disconnected', { runId });
  if (pollInterval) clearTimeout(pollInterval);
  clearInterval(heartbeat);
  res.end();
    });

    req.on('error', (error) => {
      logger.error('Triage stream error', { runId, error: error.message });
  if (pollInterval) clearTimeout(pollInterval);
  clearInterval(heartbeat);
  res.end();
    });
  });

  return router;
};