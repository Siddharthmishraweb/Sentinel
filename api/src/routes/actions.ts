import { Router, Request, Response } from 'express';
import { RouteConfig } from './index';

const router = Router();

export const createActionsRouter = (config: RouteConfig) => {
  const { database, logger } = config;

  // Freeze card action
  router.post('/freeze-card', async (req: Request, res: Response): Promise<void> => {
    try {
      const { cardId, customerId, reason } = req.body;

      if (!cardId) {
        res.status(400).json({ error: 'Card ID is required' });
        return;
      }

      // Update card status to frozen
      const query = `
        UPDATE cards 
        SET status = 'FROZEN', frozen_at = NOW(), frozen_by = 'system'
        WHERE id = $1
        RETURNING *
      `;

      const result = await database.query(query, [cardId]);
      
      if (result.length === 0) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      // Log the action
      logger.info('Card frozen', { cardId, customerId, reason });

      res.json({
        success: true,
        message: 'Card has been frozen successfully',
        card: result[0],
        action: {
          type: 'freeze_card',
          timestamp: new Date().toISOString(),
          reason: reason || 'Security measure'
        }
      });
    } catch (error: any) {
      logger.error('Failed to freeze card', { error, cardId: req.body.cardId });
      res.status(500).json({ 
        error: 'Failed to freeze card',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Open dispute action
  router.post('/open-dispute', async (req: Request, res: Response): Promise<void> => {
    try {
      const { transactionId, customerId, reasonCode, description } = req.body;

      if (!transactionId || !reasonCode) {
        res.status(400).json({ error: 'Transaction ID and reason code are required' });
        return;
      }

      // Create a new dispute case
      const caseQuery = `
        INSERT INTO cases (
          id, customer_id, transaction_id, type, status, 
          description, created_at, updated_at
        ) 
        VALUES ($1, $2, $3, 'DISPUTE', 'OPEN', $4, NOW(), NOW())
        RETURNING *
      `;

      const caseId = `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await database.query(caseQuery, [
        caseId, 
        customerId, 
        transactionId, 
        description || `Dispute for reason: ${reasonCode}`
      ]);

      // Log the action
      logger.info('Dispute opened', { transactionId, customerId, reasonCode, caseId });

      res.json({
        success: true,
        message: 'Dispute has been opened successfully',
        case: result[0],
        action: {
          type: 'open_dispute',
          timestamp: new Date().toISOString(),
          reasonCode,
          caseId
        }
      });
    } catch (error: any) {
      logger.error('Failed to open dispute', { error, transactionId: req.body.transactionId });
      res.status(500).json({ 
        error: 'Failed to open dispute',
        message: error?.message || 'Unknown error'
      });
    }
  });

  // Contact customer action
  router.post('/contact-customer', async (req: Request, res: Response): Promise<void> => {
    try {
      const { customerId, method, message, subject } = req.body;

      if (!customerId || !method || !message) {
        res.status(400).json({ error: 'Customer ID, contact method, and message are required' });
        return;
      }

      // Log the contact attempt (in a real system, this would trigger actual communication)
      const logQuery = `
        INSERT INTO customer_communications (
          id, customer_id, method, subject, message, 
          status, created_at
        ) 
        VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
        RETURNING *
      `;

      const communicationId = `comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await database.query(logQuery, [
        communicationId,
        customerId,
        method,
        subject || 'Security Alert',
        message
      ]);

      logger.info('Customer contacted', { customerId, method, communicationId });

      res.json({
        success: true,
        message: `Customer contacted via ${method}`,
        communication: result[0],
        action: {
          type: 'contact_customer',
          timestamp: new Date().toISOString(),
          method,
          communicationId
        }
      });
    } catch (error: any) {
      logger.error('Failed to contact customer', { error, customerId: req.body.customerId });
      res.status(500).json({ 
        error: 'Failed to contact customer',
        message: error?.message || 'Unknown error'
      });
    }
  });

  return router;
};