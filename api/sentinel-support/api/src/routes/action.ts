import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { RedisClient } from '../utils/redis';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { RedactorAgent } from '../agents/redactor';
import { v4 as uuidv4 } from 'uuid';

interface RouteConfig {
  database: Database;
  redis: RedisClient;
  metrics: MetricsService;
  logger: Logger;
}

interface FreezeCardRequest {
  cardId: string;
  otp?: string;
  reason?: string;
}

interface OpenDisputeRequest {
  txnId: string;
  reasonCode: string;
  confirm: boolean;
  customerId?: string;
}

export const actionRoutes = (config: RouteConfig): Router => {
  const router = Router();
  const { database, redis, metrics, logger } = config;

  // Middleware to check API key
  const requireApiKey = (req: Request, res: Response, next: Function) => {
    const apiKey = req.header('X-API-Key');
    const expectedKey = process.env.API_KEY || 'sentinel-api-key-2024';

    if (!apiKey || apiKey !== expectedKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid X-API-Key required'
      });
      return;
    }

    next();
  };

  // Middleware to handle idempotency
  const handleIdempotency = async (req: Request, res: Response, next: Function) => {
    const idempotencyKey = req.header('Idempotency-Key');
    
    if (idempotencyKey) {
      try {
        const existing = await redis.get(`idempotency:${idempotencyKey}`);
        if (existing) {
          const result = JSON.parse(existing as string);
          logger.info('Returning cached idempotent response', { idempotencyKey });
          res.json(result);
          return;
        }
        
        // Store the key for this request
        (req as any).idempotencyKey = idempotencyKey;
      } catch (error) {
        logger.error('Idempotency check failed', { error });
      }
    }

    next();
  };

  // Store idempotent result
  const storeIdempotentResult = async (req: Request, result: any) => {
    const idempotencyKey = (req as any).idempotencyKey;
    if (idempotencyKey) {
      try {
        await redis.set(`idempotency:${idempotencyKey}`, JSON.stringify(result), 3600);
      } catch (error) {
        logger.error('Failed to store idempotent result', { error, idempotencyKey });
      }
    }
  };

  // Freeze card action
  router.post('/freeze-card', requireApiKey, handleIdempotency, async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = uuidv4();
    
    try {
  const { cardId, otp, reason = 'Fraud prevention' }: FreezeCardRequest = req.body;
  const auth = (req as any).auth;

      if (!cardId) {
        res.status(400).json({
          error: 'Missing required field: cardId',
          requestId
        });
        return;
      }

      logger.info('Processing freeze card request', { 
        requestId, 
        cardId: RedactorAgent.redactText(cardId).redacted,
        hasOtp: !!otp 
      });

      // Check if OTP is required based on card/customer policy
  const requiresOtp = await checkOtpRequired(cardId);
  const bypassOtp = auth?.permissions?.includes('bypass_otp');
      
  if (requiresOtp && !otp && !bypassOtp) {
        metrics.incrementCounter('action_blocked_total', { policy: 'otp_required' });
        
        const result = {
          status: 'PENDING_OTP',
          requestId,
          message: 'OTP verification required',
          timestamp: Date.now()
        };

        await storeIdempotentResult(req, result);
        res.json(result);
        return;
      }

  if (requiresOtp && otp && !bypassOtp) {
        // Verify OTP (mock implementation)
        const otpValid = await verifyOtp(cardId, otp);
        
        if (!otpValid) {
          metrics.incrementCounter('action_blocked_total', { policy: 'invalid_otp' });
          
          res.status(400).json({
            error: 'Invalid OTP',
            requestId,
            timestamp: Date.now()
          });
          return;
        }
      }

      // Simulate freezing the card
      await freezeCard(cardId, reason, requestId);
      
      // Log the action for audit
      await logAuditEvent({
        action: 'FREEZE_CARD',
        cardId,
        reason,
        requestId,
        timestamp: Date.now(),
        actor: auth?.userId || 'system',
        metadata: { otpUsed: !!otp, bypassOtp }
      });

      metrics.incrementCounter('tool_call_total', { tool: 'freeze_card', ok: 'true' });

      const result = {
        status: 'FROZEN',
        requestId,
        cardId,
        reason,
        timestamp: Date.now()
      };

      await storeIdempotentResult(req, result);
      res.json(result);

    } catch (error: any) {
      logger.error('Freeze card action failed', { 
        requestId, 
        error: error?.message 
      });

      metrics.incrementCounter('tool_call_total', { tool: 'freeze_card', ok: 'false' });
      
      res.status(500).json({
        error: 'Failed to freeze card',
        requestId,
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('POST', '/action/freeze-card', 200, Date.now() - startTime);
    }
  });

  // Open dispute action  
  router.post('/open-dispute', requireApiKey, handleIdempotency, async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = uuidv4();
    
    try {
      const { txnId, reasonCode, confirm, customerId }: OpenDisputeRequest = req.body;

      if (!txnId || !reasonCode || !confirm) {
        res.status(400).json({
          error: 'Missing required fields: txnId, reasonCode, confirm',
          requestId
        });
        return;
      }

  const auth = (req as any).auth;
  logger.info('Processing open dispute request', { 
        requestId, 
        txnId: RedactorAgent.redactText(txnId).redacted,
        reasonCode,
        customerId 
      });

      // Validate reason code
      const validReasonCodes = ['10.4', '4855', '4837', '4863', '4834'];
      if (!validReasonCodes.includes(reasonCode)) {
        res.status(400).json({
          error: 'Invalid reason code',
          validCodes: validReasonCodes,
          requestId
        });
        return;
      }

      // Create dispute case
      const caseId = await createDisputeCase({
        txnId,
        reasonCode,
        customerId,
        requestId
      });

      // Log the action for audit
      await logAuditEvent({
        action: 'OPEN_DISPUTE',
        txnId,
        caseId,
        reasonCode,
        requestId,
        timestamp: Date.now(),
        actor: auth?.userId || 'system',
        metadata: { confirm }
      });

      metrics.incrementCounter('tool_call_total', { tool: 'open_dispute', ok: 'true' });

      const result = {
        status: 'OPEN',
        caseId,
        txnId,
        reasonCode,
        requestId,
        timestamp: Date.now()
      };

      await storeIdempotentResult(req, result);
      res.json(result);

    } catch (error: any) {
      logger.error('Open dispute action failed', { 
        requestId, 
        error: error?.message 
      });

      metrics.incrementCounter('tool_call_total', { tool: 'open_dispute', ok: 'false' });
      
      res.status(500).json({
        error: 'Failed to open dispute',
        requestId,
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('POST', '/action/open-dispute', 200, Date.now() - startTime);
    }
  });

  // Contact Customer Action
  router.post('/contact-customer', requireApiKey, handleIdempotency, async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.get('X-Request-ID') || uuidv4();
    
    try {
  const { customerId, communicationType, template, variables } = req.body;
  const auth = (req as any).auth;

      if (!customerId || !communicationType || !template) {
        res.status(400).json({
          error: 'Missing required fields',
          message: 'customerId, communicationType, and template are required',
          requestId
        });
        return;
      }

      // Validate communication type
      if (!['email', 'sms', 'phone'].includes(communicationType)) {
        res.status(400).json({
          error: 'Invalid communication type',
          message: 'communicationType must be email, sms, or phone',
          requestId
        });
        return;
      }

      logger.info('Processing contact customer request', { 
        requestId, 
        customerId: RedactorAgent.redactText(customerId).redacted,
        communicationType,
        template
      });

      // Send communication (mock implementation)
      const communicationId = await sendCustomerCommunication({
        customerId,
        communicationType,
        template,
        variables: variables || {},
        requestId
      });

      // Log the action for audit
      await logAuditEvent({
        action: 'CONTACT_CUSTOMER',
        customerId,
        communicationType,
        template,
        communicationId,
        requestId,
        timestamp: Date.now(),
        actor: auth?.userId || 'system',
        metadata: { variables }
      });

      metrics.incrementCounter('tool_call_total', { tool: 'contact_customer', ok: 'true' });

      const result = {
        status: 'SENT',
        communicationId,
        customerId,
        type: communicationType,
        requestId,
        timestamp: Date.now()
      };

      await storeIdempotentResult(req, result);
      res.json(result);

    } catch (error: any) {
      logger.error('Contact customer action failed', { 
        requestId, 
        error: error?.message 
      });

      metrics.incrementCounter('tool_call_total', { tool: 'contact_customer', ok: 'false' });
      
      res.status(500).json({
        error: 'Failed to contact customer',
        requestId,
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('POST', '/action/contact-customer', 200, Date.now() - startTime);
    }
  });

  // Mark False Positive Action
  router.post('/mark-false-positive', requireApiKey, handleIdempotency, async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.get('X-Request-ID') || uuidv4();
    
    try {
  const { alertId, reason }: { alertId: string; reason?: string } = req.body;
  const auth = (req as any).auth;

      if (!alertId) {
        res.status(400).json({
          error: 'Missing required field: alertId',
          requestId
        });
        return;
      }

      logger.info('Marking alert as false positive', { 
        alertId: RedactorAgent.redactText(alertId).redacted, 
        reason,
        requestId 
      });

      // Update alert status in database and create a case for traceability
      let caseId: string | undefined;
      try {
        // Update alert status (soft update; ignore failure for demo if row absent)
        await database.query(
          'UPDATE alerts SET status = $2, updated_at = NOW() WHERE id = $1',
          [alertId, 'FALSE_POSITIVE']
        ).catch(() => {});

        // Create a lightweight case to tie audit events if not already present
        const caseRows = await database.query<{ id: string }>(
          `INSERT INTO cases (customer_id, alert_id, type, status, reason_code, metadata)
           VALUES ($1, $2, 'ALERT', 'CLOSED', $3, $4) RETURNING id`,
          [null, alertId, 'FALSE_POSITIVE', JSON.stringify({ requestId })]
        ).catch(() => []);
        caseId = caseRows[0]?.id;
      } catch (e) {
        logger.warn('Failed to create case for false positive', { alertId, requestId, error: (e as any)?.message });
      }

      const result = {
        status: 'FALSE_POSITIVE',
        alertId: alertId,
        markedAt: new Date().toISOString(),
        reason: reason || 'No reason provided',
        caseId,
        requestId
      };

      // Audit logging
      await logAuditEvent({
        action: 'MARK_FALSE_POSITIVE',
        alertId,
        caseId,
        reason,
        requestId,
        timestamp: Date.now(),
        actor: auth?.userId || 'system',
        metadata: { reason }
      });

      res.json(result);
      
      metrics.incrementCounter('tool_call_total', { tool: 'mark_false_positive', ok: 'true' });
      
    } catch (error: any) {
      logger.error('Failed to mark false positive', { error: error?.message, requestId });
      
      metrics.incrementCounter('tool_call_total', { tool: 'mark_false_positive', ok: 'false' });
      
      res.status(500).json({
        error: 'Failed to mark false positive',
        requestId,
        details: error?.message
      });
    } finally {
      metrics.recordHttpRequest('POST', '/action/mark-false-positive', 200, Date.now() - startTime);
    }
  });

  return router;

  // Helper functions
  async function checkOtpRequired(cardId: string): Promise<boolean> {
    // Mock implementation - in reality would check customer tier, amount, etc.
    return true; // Always require OTP for demo
  }

  async function verifyOtp(cardId: string, otp: string): Promise<boolean> {
    // Mock implementation - accept 123456 for demo
    return otp === '123456';
  }

  async function freezeCard(cardId: string, reason: string, requestId: string): Promise<void> {
    // Mock implementation - would update database
    logger.info('Card frozen', { cardId, reason, requestId });
  }

  async function createDisputeCase(params: {
    txnId: string;
    reasonCode: string;
    customerId?: string;
    requestId: string;
  }): Promise<string> {
    // Create a dispute case row in DB and return id
    try {
      const rows = await database.query<{ id: string }>(
        `INSERT INTO cases (customer_id, txn_id, type, status, reason_code, metadata)
         VALUES ($1, $2, 'DISPUTE', 'OPEN', $3, $4) RETURNING id`,
        [params.customerId, params.txnId, params.reasonCode, JSON.stringify({ requestId: params.requestId })]
      );
      const caseId = rows[0].id;
      logger.info('Dispute case created', { caseId, ...params });
      return caseId;
    } catch (error) {
      logger.error('Failed to create dispute case', { error, ...params });
      throw error;
    }
  }

  async function logAuditEvent(event: {
    action: string;
    timestamp: number;
    actor: string;
    requestId: string;
    metadata: any;
    caseId?: string;
    customerId?: string;
    alertId?: string;
    cardId?: string;
    txnId?: string;
    [key: string]: any;
  }): Promise<void> {
    // Redact sensitive data before logging
    const { data: redactedEvent, masked } = RedactorAgent.redactForLogging(event);
    logger.info('Audit event', { ...redactedEvent, masked, event_type: 'audit' });

    // Persist to case_events if caseId available
    if (event.caseId) {
      try {
        await database.query(
          `INSERT INTO case_events (case_id, actor, action, payload_json, request_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            event.caseId,
            event.actor,
            event.action,
            JSON.stringify({
              requestId: event.requestId,
              metadata: event.metadata,
              customerId: event.customerId,
              alertId: event.alertId,
              cardId: event.cardId,
              txnId: event.txnId
            }),
            event.requestId
          ]
        );
      } catch (error) {
        logger.error('Failed to insert case_event', { error, requestId: event.requestId, action: event.action });
      }
    }

    // Also store short-lived copy in Redis for quick lookup (optional caching layer)
    try {
      await redis.set(`audit:${event.requestId}`, JSON.stringify(redactedEvent), 86400); // 1 day
    } catch (error) {
      logger.error('Failed to cache audit event', { error, requestId: event.requestId });
    }
  }

  async function sendCustomerCommunication(params: {
    customerId: string;
    communicationType: 'email' | 'sms' | 'phone';
    template: string;
    variables: Record<string, any>;
    requestId: string;
  }): Promise<string> {
    // Mock implementation - would integrate with communication service
    const communicationId = `COMM-${Date.now()}-${params.requestId.slice(0, 8)}`;
    
    logger.info('Customer communication sent', { 
      communicationId, 
      customerId: RedactorAgent.redactText(params.customerId).redacted,
      type: params.communicationType,
      template: params.template
    });
    
    // Simulate delay for external service call
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return communicationId;
  }
};