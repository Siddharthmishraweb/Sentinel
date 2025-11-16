// Multi-Agent Orchestrator with timeout handling and circuit breakers
import { Logger } from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { RedisClient } from '../utils/redis';
import { Database } from '../utils/database';
import { MetricsService } from '../services/metrics';
import { z } from 'zod';

export interface AgentResult {
  success: boolean;
  data?: any;
  error?: string;
  duration_ms: number;
  fallback_used: boolean;
}

export interface TriageStep {
  step: string;
  agent: string;
  timeout_ms: number;
  retries: number;
}

export interface TriagePlan {
  steps: TriageStep[];
  budget_ms: number;
}

export interface TriageContext {
  runId: string;
  alertId: string;
  customerId: string;
  transactionId?: string;
  startTime: number;
}

export interface StreamEvent {
  type: 'plan_built' | 'tool_update' | 'fallback_triggered' | 'decision_finalized' | 'error';
  data: any;
  timestamp: number;
}

export class MultiAgentOrchestrator {
  private redis: RedisClient;
  private logger: Logger;
  private circuitBreakers: Map<string, { failures: number; lastFailure: number; isOpen: boolean }> = new Map();
  private database: Database;
  private metrics?: MetricsService;

  constructor(redis: RedisClient, logger: Logger, database?: Database, metrics?: MetricsService) {
    this.redis = redis;
    this.logger = logger;
    this.database = database as Database;
    this.metrics = metrics;
  }

  async startTriage(alertId: string, customerId: string, transactionId?: string): Promise<string> {
    const runId = uuidv4();
    const context: TriageContext = {
      runId,
      alertId,
      customerId,
      transactionId,
      startTime: Date.now()
    };

    this.logger.info('Starting triage run', { runId, alertId, customerId });

    // Build default plan
    const plan: TriagePlan = {
      budget_ms: 5000,
      steps: [
        { step: 'getProfile', agent: 'insights', timeout_ms: 1000, retries: 2 },
        { step: 'recentTx', agent: 'insights', timeout_ms: 1000, retries: 2 },
        { step: 'riskSignals', agent: 'fraud', timeout_ms: 1000, retries: 2 },
        { step: 'kbLookup', agent: 'kb', timeout_ms: 1000, retries: 2 },
        { step: 'decide', agent: 'fraud', timeout_ms: 1000, retries: 2 },
        { step: 'proposeAction', agent: 'compliance', timeout_ms: 1000, retries: 2 }
      ]
    };

    // Persist triage_runs initial row if DB available
    if (this.database) {
      try {
        await this.database.query(
          `INSERT INTO triage_runs (id, alert_id, started_at, metadata) VALUES ($1, $2, NOW(), $3)`,
          [runId, alertId, { customerId }]
        );
      } catch (err: any) {
        this.logger.error('Failed to persist triage_runs start', { runId, error: err.message });
      }
    }

    // Store plan and emit event
    await this.redis.set(`triage:${runId}:plan`, JSON.stringify(plan), 300);
    await this.emitEvent(runId, {
      type: 'plan_built',
      data: { plan, steps: plan.steps.length },
      timestamp: Date.now()
    });

    // Execute plan asynchronously
    setImmediate(() => this.executePlan(context, plan));

    return runId;
  }

  private async executePlan(context: TriageContext, plan: TriagePlan): Promise<void> {
    const { runId } = context;
    const results: Record<string, AgentResult> = {};
    let totalDuration = 0;
    let seq = 0;
    let fallbackUsedOverall = false;

    try {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const stepStart = Date.now();

        // Check budget
        if (totalDuration >= plan.budget_ms) {
          this.logger.warn('Triage budget exceeded', { runId, step: step.step });
          break;
        }

        this.logger.info('Executing triage step', { runId, step: step.step, agent: step.agent });

        const safeContext = this.sanitizeContext(context);
        const result = await this.executeStep(safeContext, step);
        results[step.step] = result;
        totalDuration += result.duration_ms;

        if (result.fallback_used) {
          fallbackUsedOverall = true;
          // Emit explicit fallback_triggered event
          await this.emitEvent(runId, {
            type: 'fallback_triggered',
            data: { step: step.step, agent: step.agent },
            timestamp: Date.now()
          });
          this.metrics?.recordAgentFallback(step.agent);
        }

        // Persist agent_traces row if DB available
        if (this.database) {
          try {
            await this.database.query(
              `INSERT INTO agent_traces (run_id, seq, step, agent, ok, duration_ms, detail_json, started_at, ended_at, retry_count)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || INTERVAL '0 ms'), NOW(), $9)`,
              [
                runId,
                seq++,
                step.step,
                step.agent,
                result.success,
                result.duration_ms,
                { fallback: result.fallback_used },
                result.duration_ms,
                (result as any).retries || 0
              ]
            );
          } catch (err: any) {
            this.logger.error('Failed to persist agent trace', { runId, step: step.step, error: err.message });
          }
        }

        // Emit update
        await this.emitEvent(runId, {
          type: 'tool_update',
          data: {
            step: step.step,
            agent: step.agent,
            success: result.success,
            duration_ms: result.duration_ms,
            fallback_used: result.fallback_used
          },
          timestamp: Date.now()
        });

        // Handle step failure
        if (!result.success && step.retries === 0) {
          this.logger.error('Step failed without retries', { runId, step: step.step, error: result.error });
        }
      }

      // Generate final decision
      const decision = await this.generateDecision(context, results);
      
      // Store results in Redis (quick access)
      await this.redis.set(`triage:${runId}:results`, JSON.stringify({
        results,
        decision,
        totalDuration,
        completedAt: Date.now(),
        fallback_used: fallbackUsedOverall
      }), 86400);

      // Update triage_runs persistence
      if (this.database) {
        try {
          await this.database.query(
            `UPDATE triage_runs
             SET ended_at = NOW(), latency_ms = $2, risk_level = $3, recommended_action = $4, fallback_used = $5, reasons = $6
             WHERE id = $1`,
            [
              runId,
              totalDuration,
              decision.risk_level,
              decision.recommended_action,
              fallbackUsedOverall,
              decision.reasons
            ]
          );
        } catch (err: any) {
          this.logger.error('Failed to update triage_runs completion', { runId, error: err.message });
        }
      }

      // Emit final decision
      await this.emitEvent(runId, {
        type: 'decision_finalized',
        data: decision,
        timestamp: Date.now()
      });

    } catch (error: any) {
      this.logger.error('Triage execution failed', { runId, error: error?.message });
      await this.emitEvent(runId, {
        type: 'error',
        data: { message: error?.message || 'Unknown error' },
        timestamp: Date.now()
      });
    }
  }

  private async executeStep(context: TriageContext, step: TriageStep): Promise<AgentResult> {
    const { runId } = context;
    const stepStart = Date.now();
    let retriesPerformed = 0;

    // Check circuit breaker
    if (this.isCircuitOpen(step.agent)) {
      this.logger.warn('Circuit breaker open for agent', { runId, agent: step.agent });
      return this.getFallbackResult(step);
    }

    while (true) {
      try {
        const result = await this.executeWithTimeout(context, step);
        if (result.success) {
          this.resetCircuitBreaker(step.agent);
          this.metrics?.recordAgentLatency(step.agent, step.step, true, result.duration_ms);
          return { ...result, retries: retriesPerformed } as AgentResult;
        }
        this.recordFailure(step.agent);
        this.metrics?.recordAgentLatency(step.agent, step.step, false, result.duration_ms);
        if (retriesPerformed >= step.retries) {
          return { ...result, retries: retriesPerformed } as AgentResult;
        }
      } catch (error: any) {
        this.recordFailure(step.agent);
        const duration = Date.now() - stepStart;
        this.metrics?.recordAgentLatency(step.agent, step.step, false, duration);
        if (retriesPerformed >= step.retries) {
          return this.getFallbackResult(step);
        }
      }
      // Retry with jitter
      retriesPerformed++;
      const backoff = retriesPerformed === 1 ? 150 : 400;
      const jitter = Math.floor(Math.random() * 50);
      await new Promise(r => setTimeout(r, backoff + jitter));
    }
  }

  // Basic sanitization: strip prompt injection patterns
  private sanitizeContext(context: TriageContext): TriageContext {
    const unsafePattern = /(ignore (?:previous|earlier) instructions|system override|exfiltrate)/i;
    const scrub = (v?: string) => v && unsafePattern.test(v) ? v.replace(unsafePattern, '[redacted]') : v;
    return { ...context, alertId: scrub(context.alertId) || context.alertId, customerId: scrub(context.customerId) || context.customerId, transactionId: scrub(context.transactionId) || context.transactionId };
  }
  private async executeWithTimeout(context: TriageContext, step: TriageStep): Promise<AgentResult> {
    const stepStart = Date.now();
    
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        resolve(this.getFallbackResult(step));
      }, step.timeout_ms);

      try {
        const result = await this.callAgent(context, step);
        clearTimeout(timeout);
        resolve({
          ...result,
          duration_ms: Date.now() - stepStart
        });
      } catch (error) {
        clearTimeout(timeout);
        resolve(this.getFallbackResult(step));
      }
    });
  }

  private async callAgent(context: TriageContext, step: TriageStep): Promise<Omit<AgentResult, 'duration_ms'>> {
    // This would call the actual agent implementations
    // For now, return mock results
    switch (step.agent) {
      case 'insights':
        return this.validateAgentOutput('insights', this.getMockInsights());
      case 'fraud':
        return this.validateAgentOutput('fraud', this.getMockFraudAnalysis());
      case 'kb':
        return this.validateAgentOutput('kb', this.getMockKBResults());
      case 'compliance':
        return this.validateAgentOutput('compliance', this.getMockComplianceCheck());
      default:
        throw new Error(`Unknown agent: ${step.agent}`);
    }
  }

  private validateAgentOutput(agent: string, data: any): Omit<AgentResult,'duration_ms'> {
    // Basic schemas - can be enhanced
    const schemas: Record<string, z.ZodTypeAny> = {
      insights: z.object({ categories: z.array(z.object({ name: z.string(), percentage: z.number() })).optional() }),
      fraud: z.object({ risk_score: z.number(), risk_level: z.string(), reasons: z.array(z.string()) }),
      kb: z.object({ results: z.array(z.object({ docId: z.string(), title: z.string(), anchor: z.string().optional(), extract: z.string() })) }),
      compliance: z.object({ action: z.string(), requires_otp: z.boolean().optional() })
    };
    const schema = schemas[agent];
    try {
      if (schema) schema.parse(data);
      return { success: true, data, fallback_used: false };
    } catch (err: any) {
      this.logger.warn('Schema validation failed', { agent, error: err.message });
      return { success: false, data: this.getFallbackData(agent), fallback_used: true };
    }
  }

  private getFallbackResult(step: TriageStep): AgentResult {
    return {
      success: false,
      data: this.getFallbackData(step.agent),
      error: 'Agent unavailable, using fallback',
      duration_ms: 0,
      fallback_used: true
    };
  }

  private getFallbackData(agent: string): any {
    switch (agent) {
      case 'fraud':
        return { risk_score: 50, risk_level: 'MEDIUM', reasons: ['risk_unavailable'] };
      case 'insights':
        return { categories: [], merchants: [], anomalies: [] };
      case 'kb':
        return { results: [] };
      case 'compliance':
        return { action: 'INVESTIGATE', requires_otp: false };
      default:
        return {};
    }
  }

  private async generateDecision(context: TriageContext, results: Record<string, AgentResult>): Promise<any> {
    const fraudResult = results.riskSignals?.data;
    const complianceResult = results.proposeAction?.data;
    
    return {
      risk_score: fraudResult?.risk_score || 50,
      risk_level: fraudResult?.risk_level || 'MEDIUM',
      recommended_action: complianceResult?.action || 'INVESTIGATE',
      requires_otp: complianceResult?.requires_otp || false,
      reasons: fraudResult?.reasons || ['insufficient_data'],
      confidence: 0.75,
      fallback_used: Object.values(results).some(r => r.fallback_used)
    };
  }

  private isCircuitOpen(agent: string): boolean {
    const breaker = this.circuitBreakers.get(agent);
    if (!breaker) return false;

    if (breaker.isOpen && Date.now() - breaker.lastFailure > 30000) {
      // Reset after 30 seconds
      breaker.isOpen = false;
      breaker.failures = 0;
    }

    return breaker.isOpen;
  }

  private recordFailure(agent: string): void {
    const breaker = this.circuitBreakers.get(agent) || { failures: 0, lastFailure: 0, isOpen: false };
    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= 3) {
      breaker.isOpen = true;
      this.logger.warn('Circuit breaker opened', { agent, failures: breaker.failures, cooldown_ms: 30000 });
    }

    this.circuitBreakers.set(agent, breaker);
  }

  private resetCircuitBreaker(agent: string): void {
    this.circuitBreakers.set(agent, { failures: 0, lastFailure: 0, isOpen: false });
  }

  private async emitEvent(runId: string, event: StreamEvent): Promise<void> {
    await this.redis.lpush(`triage:${runId}:events`, JSON.stringify(event));
    await this.redis.expire(`triage:${runId}:events`, 300);
  }

  async getEvents(runId: string): Promise<StreamEvent[]> {
    const events = await this.redis.lrange(`triage:${runId}:events`, 0, -1);
    return events.map((e: string) => JSON.parse(e)).reverse();
  }

  // Mock data generators
  private getMockInsights() {
    return {
      categories: [
        { name: 'Transport', percentage: 0.23 },
        { name: 'Food', percentage: 0.45 },
        { name: 'Retail', percentage: 0.32 }
      ],
      merchants: [
        { name: 'Uber', count: 12, amount: 240.50 },
        { name: 'Starbucks', count: 8, amount: 64.00 }
      ],
      anomalies: [
        { date: '2025-11-14', z_score: 3.1, note: 'Unusual spending spike' }
      ]
    };
  }

  private getMockFraudAnalysis() {
    return {
      risk_score: 75,
      risk_level: 'HIGH',
      reasons: ['velocity_anomaly', 'new_merchant', 'unusual_amount'],
      indicators: {
        velocity_check: { score: 80, details: '3 transactions in 5 minutes' },
        merchant_check: { score: 60, details: 'First time at this merchant' },
        amount_check: { score: 90, details: 'Amount 3.2x average transaction' }
      }
    };
  }

  private getMockKBResults() {
    return {
      results: [
        {
          docId: 'kb-001',
          title: 'Fraud Investigation Procedures',
          anchor: 'velocity-checks',
          extract: 'When multiple transactions occur within a short timeframe...'
        }
      ]
    };
  }

  private getMockComplianceCheck() {
    return {
      action: 'FREEZE_CARD',
      requires_otp: true,
      policy_checks: {
        amount_threshold: { passed: false, details: 'Amount exceeds $500 limit' },
        customer_tier: { passed: true, details: 'Premium customer' }
      }
    };
  }
}