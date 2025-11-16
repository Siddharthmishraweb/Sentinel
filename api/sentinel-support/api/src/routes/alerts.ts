import { Router, Request, Response } from 'express';
import { RouteConfig } from './index';

const router = Router();

export const createAlertsRouter = (config: RouteConfig) => {
  const { database, logger } = config;

  // Get all alerts with pagination and filtering
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        risk_level,
        status,
        cursor,
        limit = '10',
        customer_id
      } = req.query;

      let query = `
        SELECT 
          a.id,
          a.customer_id,
          a.suspect_txn_id,
          a.risk_score,
          a.risk_level as priority,
          a.status,
          a.reasons,
          a.created_at,
          a.resolved_at as updated_at,
          a.resolved_by as assigned_agent,
          c.name as customer_name
        FROM alerts a
        LEFT JOIN customers c ON a.customer_id = c.id
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramIndex = 1;

      if (risk_level) {
        query += ` AND a.risk_level = $${paramIndex++}`;
        params.push(risk_level);
      }

      if (status) {
        query += ` AND a.status = $${paramIndex++}`;
        params.push(status);
      }

      if (customer_id) {
        query += ` AND a.customer_id = $${paramIndex++}`;
        params.push(customer_id);
      }

      if (cursor) {
        query += ` AND a.created_at < $${paramIndex++}`;
        params.push(cursor);
      }

      query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit as string));

      const alerts = await database.query(query, params);

      const hasNext = alerts.length === parseInt(limit as string);
      const nextCursor = hasNext ? alerts[alerts.length - 1]?.created_at : null;

      res.json({
        data: alerts,
        pagination: {
          next_cursor: nextCursor,
          has_next: hasNext
        }
      });
    } catch (error: any) {
      logger.error('Failed to fetch alerts', { error });
      res.status(500).json({ 
        error: 'Failed to fetch alerts',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Get specific alert
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      
      const query = `
        SELECT 
          a.id,
          a.customer_id,
          a.suspect_txn_id,
          a.risk_score,
          a.risk_level as priority,
          a.status,
          a.reasons,
          a.created_at,
          a.resolved_at as updated_at,
          a.resolved_by as assigned_agent,
          c.name as customer_name
        FROM alerts a
        LEFT JOIN customers c ON a.customer_id = c.id
        WHERE a.id = $1
      `;

      const alerts = await database.query(query, [id]);
      
      if (alerts.length === 0) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.json(alerts[0]);
    } catch (error: any) {
      logger.error('Failed to fetch alert', { error, alertId: req.params.id });
      res.status(500).json({ 
        error: 'Failed to fetch alert',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Assign alert to agent
  router.post('/:id/assign', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { agent } = req.body;

      if (!agent) {
        res.status(400).json({ error: 'Agent name is required' });
        return;
      }

      const query = `
        UPDATE alerts 
        SET assigned_agent = $1, status = 'assigned', updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const result = await database.query(query, [agent, id]);
      
      if (result.length === 0) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      logger.info('Alert assigned', { alertId: id, agent });
      res.json(result[0]);
    } catch (error: any) {
      logger.error('Failed to assign alert', { error, alertId: req.params.id });
      res.status(500).json({ 
        error: 'Failed to assign alert',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Resolve alert
  router.post('/:id/resolve', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { resolution_notes, status = 'resolved' } = req.body;

      const query = `
        UPDATE alerts 
        SET status = $1, resolution_notes = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;

      const result = await database.query(query, [status, resolution_notes, id]);
      
      if (result.length === 0) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      logger.info('Alert resolved', { alertId: id, status });
      res.json(result[0]);
    } catch (error: any) {
      logger.error('Failed to resolve alert', { error, alertId: req.params.id });
      res.status(500).json({ 
        error: 'Failed to resolve alert',
        message: error?.message || 'Unknown error'
      });
    }
  });

  return router;
};