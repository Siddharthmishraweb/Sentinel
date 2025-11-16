import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { asyncErrorHandler } from '../middleware';

interface RouteConfig {
  database: Database;
  metrics: MetricsService;
  logger: Logger;
}

export const createCustomerRouter = (config: RouteConfig): Router => {
  const router = Router();
  const { database, metrics, logger } = config;

  // Get customer profile
  router.get('/:customerId', asyncErrorHandler(async (req: Request, res: Response) => {
    const { customerId } = req.params;
    const requestId = req.get('X-Request-ID');

    logger.info('Fetching customer profile', { requestId, customerId });

    try {
      const result = await database.query(
        'SELECT * FROM customer_data WHERE customer_id = $1',
        [customerId]
      );

      if (result.length === 0) {
        metrics.incrementCounter('customer_not_found_total');
        return res.status(404).json({
          error: 'Customer not found',
          customerId,
          timestamp: new Date().toISOString()
        });
      }

      metrics.incrementCounter('customer_fetch_total');
      
      res.json({
        success: true,
        customer: result[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch customer', { requestId, customerId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to fetch customer data',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Customer dynamic stats (cards, transactions, open alerts)
  router.get('/:customerId/stats', asyncErrorHandler(async (req: Request, res: Response) => {
    const { customerId } = req.params;
    const requestId = req.get('X-Request-ID');

    logger.info('Fetching customer stats', { requestId, customerId });

    try {
      // Parallel queries to minimize latency
      const [cardCountRows, txnCountRows, openAlertsRows] = await Promise.all([
        database.query('SELECT COUNT(*) FROM cards WHERE customer_id = $1 AND status = $2', [customerId, 'active']).catch(() => [{ count: '0' }]),
        database.query('SELECT COUNT(*) FROM transactions WHERE customer_id = $1', [customerId]).catch(() => [{ count: '0' }]),
        database.query("SELECT COUNT(*) FROM alerts WHERE customer_id = $1 AND status = 'OPEN'", [customerId]).catch(() => [{ count: '0' }])
      ]);

      const stats = {
        active_cards: parseInt(cardCountRows[0].count || '0', 10),
        transaction_count: parseInt(txnCountRows[0].count || '0', 10),
        open_alerts: parseInt(openAlertsRows[0].count || '0', 10)
      };

      metrics.incrementCounter('customer_stats_fetch_total');

      res.json({
        success: true,
        customerId,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error('Failed to fetch customer stats', { requestId, customerId, error: error.message });
      res.status(500).json({
        error: 'Failed to fetch customer stats',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Update customer profile
  router.put('/:customerId', asyncErrorHandler(async (req: Request, res: Response) => {
    const { customerId } = req.params;
    const requestId = req.get('X-Request-ID');
    const updateData = req.body;

    logger.info('Updating customer profile', { requestId, customerId });

    try {
      const result = await database.query(
        `UPDATE customer_data 
         SET data = $2, updated_at = NOW() 
         WHERE customer_id = $1 
         RETURNING *`,
        [customerId, updateData]
      );

      if (result.length === 0) {
        metrics.incrementCounter('customer_not_found_total');
        return res.status(404).json({
          error: 'Customer not found',
          customerId,
          timestamp: new Date().toISOString()
        });
      }

      metrics.incrementCounter('customer_update_total');

      res.json({
        success: true,
        customer: result[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update customer', { requestId, customerId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to update customer data',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Delete customer
  router.delete('/:customerId', asyncErrorHandler(async (req: Request, res: Response) => {
    const { customerId } = req.params;
    const requestId = req.get('X-Request-ID');

    logger.info('Deleting customer', { requestId, customerId });

    try {
      const result = await database.query(
        'DELETE FROM customer_data WHERE customer_id = $1 RETURNING customer_id',
        [customerId]
      );

      if (result.length === 0) {
        metrics.incrementCounter('customer_not_found_total');
        return res.status(404).json({
          error: 'Customer not found',
          customerId,
          timestamp: new Date().toISOString()
        });
      }

      metrics.incrementCounter('customer_delete_total');

      res.json({
        success: true,
        message: 'Customer deleted successfully',
        customerId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete customer', { requestId, customerId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to delete customer',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // List customers with pagination
  router.get('/', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100
    const offset = (page - 1) * limit;

    logger.info('Listing customers', { requestId, page, limit });

    try {
      const [countResult, dataResult] = await Promise.all([
        database.query('SELECT COUNT(*) FROM customer_data'),
        database.query(
          'SELECT customer_id, created_at, updated_at FROM customer_data ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [limit, offset]
        )
      ]);

      const total = parseInt(countResult[0].count);
      const totalPages = Math.ceil(total / limit);

      metrics.incrementCounter('customer_list_total');

      res.json({
        success: true,
        customers: dataResult,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list customers', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to retrieve customer list',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Keyset paginated transactions for a single customer
  // Spec: GET /api/customer/:id/transactions?from=&to=&cursor=&limit=
  // Spec path normalization retained; existing path matches /api/customer/:id/transactions
  router.get('/:customerId/transactions', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { customerId } = req.params;
    const { from, to, cursor, limit = '50' } = req.query;

    logger.info('Fetching customer transactions (keyset)', { requestId, customerId, from, to, cursor, limit });

    const pageLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 1000);
    try {
      // Base query restricted to customer
      let baseQuery = `SELECT id, customer_id, card_id, amount_cents, currency, merchant, mcc, ts, status, created_at
                       FROM transactions WHERE customer_id = $1`;
      const params: any[] = [customerId];
      let paramIndex = 2;

      if (from) {
        baseQuery += ` AND ts >= $${paramIndex++}`;
        params.push(from);
      }
      if (to) {
        baseQuery += ` AND ts <= $${paramIndex++}`;
        params.push(to);
      }

      // Keyset condition: use created_at cursor (decoded JSON with created_at)
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor as string, 'base64').toString());
          if (decoded && decoded.created_at) {
            baseQuery += ` AND created_at < $${paramIndex++}`;
            params.push(decoded.created_at);
          }
        } catch (e) {
          logger.warn('Invalid cursor supplied', { cursor });
        }
      }

      baseQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      params.push(pageLimit + 1); // fetch an extra row to determine nextCursor

      const rows = await database.query(baseQuery, params);
      const hasMore = rows.length > pageLimit;
      const items = hasMore ? rows.slice(0, pageLimit) : rows;
      const nextCursor = hasMore && items.length > 0
        ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at })).toString('base64')
        : null;

      metrics.incrementCounter('customer_transactions_fetch_total');

        res.json({
        success: true,
        items,
        nextCursor,
        hasMore,
        limit: pageLimit,
        timestamp: new Date().toISOString()
      });
      } catch (error: any) {
        logger.error('Failed to fetch customer transactions', { requestId, customerId, error: error.message });
        res.status(500).json({
          error: 'Failed to fetch customer transactions',
          timestamp: new Date().toISOString()
        });
      }
  }));

  return router;
};