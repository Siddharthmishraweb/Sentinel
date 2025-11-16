import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { asyncErrorHandler } from '../middleware';

interface RouteConfig {
  database: Database;
  redis: RedisClient;
  metrics: MetricsService;
  logger: Logger;
}

export const createIngestRouter = (config: RouteConfig): Router => {
  const router = Router();
  const { database, redis, metrics, logger } = config;

  // Ingest customer data
  router.post('/data', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { customerData } = req.body;

    logger.info('Ingesting customer data', { requestId, dataSize: JSON.stringify(customerData).length });

    try {
      // Validate required fields
      if (!customerData?.customerId) {
        return res.status(400).json({
          error: 'Missing required field: customerId',
          timestamp: new Date().toISOString()
        });
      }

      // Store customer data
      await database.query(
        `INSERT INTO customer_data (customer_id, data, created_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (customer_id) DO UPDATE 
         SET data = EXCLUDED.data, updated_at = NOW()`,
        [customerData.customerId, customerData]
      );

      metrics.incrementCounter('ingest_data_total', { type: 'customer_data' });

      res.json({
        success: true,
        customerId: customerData.customerId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Data ingestion failed', { requestId, error: errorMessage });
      metrics.incrementCounter('ingest_errors_total', { type: 'customer_data' });
      
      res.status(500).json({
        error: 'Data ingestion failed',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Ingest transactions endpoint
  router.post('/transactions', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID') || require('uuid').v4();
    const idempotencyKey = req.header('Idempotency-Key');
    const { transactions } = req.body;

    logger.info('Ingesting transactions', { 
      requestId, 
      transactionCount: Array.isArray(transactions) ? transactions.length : 1,
      idempotencyKey: idempotencyKey ? 'present' : 'none'
    });

    try {
      // Check idempotency if key provided
      if (idempotencyKey) {
        const cachedResult = await redis.get(`ingest:idempotency:${idempotencyKey}`);
        if (cachedResult) {
          const result = JSON.parse(cachedResult as string);
          logger.info('Returning cached ingest result', { requestId, idempotencyKey });
          return res.json(result);
        }
      }

      // Validate input
      if (!transactions) {
        return res.status(400).json({
          error: 'Missing required field: transactions',
          timestamp: new Date().toISOString(),
          requestId
        });
      }

      const txnArray = Array.isArray(transactions) ? transactions : [transactions];
      
      if (txnArray.length === 0) {
        return res.status(400).json({
          error: 'At least one transaction required',
          timestamp: new Date().toISOString(),
          requestId
        });
      }

      let processed = 0;
      let inserted = 0;
      let updated = 0;
      let errors = 0;

      // Process transactions in batches
      const batchSize = 1000;
      for (let i = 0; i < txnArray.length; i += batchSize) {
        const batch = txnArray.slice(i, i + batchSize);
        
        for (const txn of batch) {
          try {
            // Validate required fields
            if (!txn.customerId || !txn.amount_cents || !txn.merchant) {
              errors++;
              continue;
            }

            // Upsert transaction (dedupe by customerId + txnId)
            const result = await database.query(
              `INSERT INTO transactions (
                id, customer_id, card_id, amount_cents, currency,
                merchant, mcc, ts, device_id, country, city, status, created_at
              ) VALUES (
                COALESCE($1, gen_random_uuid()), $2, $3, $4, COALESCE($5, 'USD'),
                $6, $7, COALESCE($8, NOW()), $9, $10, $11, COALESCE($12, 'COMPLETED'), NOW()
              ) ON CONFLICT (id) DO UPDATE SET
                amount_cents = EXCLUDED.amount_cents,
                merchant = EXCLUDED.merchant,
                mcc = EXCLUDED.mcc,
                ts = EXCLUDED.ts,
                status = EXCLUDED.status,
                created_at = EXCLUDED.created_at
              RETURNING (xmax = 0) as inserted`,
              [
                txn.id || null,
                txn.customerId,
                txn.cardId || null,
                txn.amount_cents,
                txn.currency,
                txn.merchant,
                txn.mcc || '5999',
                txn.ts || txn.transaction_date || null,
                txn.device_id || null,
                txn.country || null,
                txn.city || null,
                txn.status
              ]
            );

            if (result && result.length > 0 && result[0]?.inserted) {
              inserted++;
            } else {
              updated++;
            }
            processed++;

          } catch (error) {
            logger.error('Failed to process transaction', { 
              requestId, 
              transactionId: txn.id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            errors++;
          }
        }
      }

      metrics.incrementCounter('ingest_transactions_total', { status: 'completed' });
      for (let i = 0; i < processed; i++) {
        metrics.incrementCounter('ingest_transactions_processed_total');
      }
      for (let i = 0; i < errors; i++) {
        metrics.incrementCounter('ingest_errors_total', { type: 'transactions' });
      }

      const result = {
        accepted: true,
        count: processed,
        requestId,
        // Extended diagnostics (non-spec but helpful)
        inserted,
        updated,
        errors,
        timestamp: new Date().toISOString()
      };

      // Cache result for idempotency
      if (idempotencyKey) {
        await redis.set(`ingest:idempotency:${idempotencyKey}`, result, 3600);
      }

      res.json(result);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Transaction ingestion failed', { requestId, error: errorMessage });
      
      metrics.incrementCounter('ingest_transactions_total', { status: 'failed' });
      
      res.status(500).json({
        error: 'Transaction ingestion failed',
        details: errorMessage,
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Batch ingest multiple records
  router.post('/batch', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: 'Invalid batch data: records array required',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Processing batch ingest', { requestId, recordCount: records.length });

    try {
      const results = [];
      
      for (const record of records) {
        if (!record.customerId) {
          results.push({ 
            customerId: null, 
            status: 'error', 
            error: 'Missing customerId' 
          });
          continue;
        }

        try {
          await database.query(
            `INSERT INTO customer_data (customer_id, data, created_at) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (customer_id) DO UPDATE 
             SET data = EXCLUDED.data, updated_at = NOW()`,
            [record.customerId, record]
          );

          results.push({ 
            customerId: record.customerId, 
            status: 'success' 
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.push({ 
            customerId: record.customerId, 
            status: 'error', 
            error: errorMessage
          });
        }
      }

      const successCount = results.filter(r => r.status === 'success').length;
      const errorCount = results.length - successCount;

      metrics.incrementCounter('ingest_batch_total');
      for (let i = 0; i < successCount; i++) {
        metrics.incrementCounter('ingest_data_total', { type: 'batch' });
      }
      for (let i = 0; i < errorCount; i++) {
        metrics.incrementCounter('ingest_errors_total', { type: 'batch' });
      }

      res.json({
        success: true,
        processed: results.length,
        succeeded: successCount,
        failed: errorCount,
        results,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Batch ingestion failed', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Batch ingestion failed',
        timestamp: new Date().toISOString()
      });
    }
  }));

  return router;
};