import { Router, Request, Response } from 'express';
import { RouteConfig } from './index';

const router = Router();

export const createTransactionsRouter = (config: RouteConfig) => {
  const { database, logger } = config;

  // Get all transactions with pagination and filtering
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        customer_id,
        card_id,
        status,
        cursor,
        limit = '10',
        start_date,
        end_date
      } = req.query;

      let query = `
        SELECT 
          t.id,
          t.customer_id,
          t.card_id,
          t.amount_cents,
          t.currency,
          t.merchant,
          t.mcc,
          t.ts as transaction_date,
          t.status,
          t.created_at,
          c.name as customer_name
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramIndex = 1;

      if (customer_id) {
        query += ` AND t.customer_id = $${paramIndex++}`;
        params.push(customer_id);
      }

      if (card_id) {
        query += ` AND t.card_id = $${paramIndex++}`;
        params.push(card_id);
      }

      if (status) {
        query += ` AND t.status = $${paramIndex++}`;
        params.push(status);
      }

      if (start_date) {
        query += ` AND t.ts >= $${paramIndex++}`;
        params.push(start_date);
      }

      if (end_date) {
        query += ` AND t.ts <= $${paramIndex++}`;
        params.push(end_date);
      }

      if (cursor) {
        query += ` AND t.created_at < $${paramIndex++}`;
        params.push(cursor);
      }

      query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit as string));

      const transactions = await database.query(query, params);

      const hasNext = transactions.length === parseInt(limit as string);
      const nextCursor = hasNext ? transactions[transactions.length - 1]?.created_at : null;

      res.json({
        data: transactions,
        pagination: {
          next_cursor: nextCursor,
          has_next: hasNext
        }
      });
    } catch (error: any) {
      logger.error('Failed to fetch transactions', { error });
      res.status(500).json({ 
        error: 'Failed to fetch transactions',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Get specific transaction
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      const query = `
        SELECT 
          t.id,
          t.customer_id,
          t.card_id,
          t.amount_cents,
          t.currency,
          t.merchant,
          t.mcc,
          t.ts as transaction_date,
          t.status,
          t.created_at,
          c.name as customer_name,
          card.last4,
          card.network
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        LEFT JOIN cards card ON t.card_id = card.id
        WHERE t.id = $1
      `;

      const transactions = await database.query(query, [id]);
      
      if (transactions.length === 0) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      res.json(transactions[0]);
    } catch (error: any) {
      logger.error('Failed to fetch transaction', { error, transactionId: req.params.id });
      res.status(500).json({ 
        error: 'Failed to fetch transaction',
        message: error?.message || 'Unknown error'
      });
    }
  });

  return router;
};