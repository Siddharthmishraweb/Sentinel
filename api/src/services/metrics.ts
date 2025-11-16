import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export class MetricsService {
  private httpRequestDuration: Histogram<string>;
  private httpRequestTotal: Counter<string>;
  private agentLatency: Histogram<string>;
  private toolCallTotal: Counter<string>;
  private agentFallbackTotal: Counter<string>;
  private rateLimitBlockTotal: Counter<string>;
  private actionBlockedTotal: Counter<string>;
  private activeConnections: Gauge<string>;

  constructor() {
    // HTTP request metrics
    this.httpRequestDuration = new Histogram({
      name: 'api_request_latency_ms',
      help: 'Duration of HTTP requests in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [1, 5, 15, 50, 100, 200, 500, 1000, 2000, 5000]
    });

    this.httpRequestTotal = new Counter({
      name: 'api_request_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    });

    // Agent metrics
    this.agentLatency = new Histogram({
      name: 'agent_latency_ms',
      help: 'Duration of agent operations in milliseconds',
      labelNames: ['agent', 'tool', 'ok'],
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000]
    });

    this.toolCallTotal = new Counter({
      name: 'tool_call_total',
      help: 'Total number of tool calls',
      labelNames: ['tool', 'ok']
    });

    this.agentFallbackTotal = new Counter({
      name: 'agent_fallback_total',
      help: 'Total number of agent fallbacks triggered',
      labelNames: ['tool']
    });

    // Rate limiting metrics
    this.rateLimitBlockTotal = new Counter({
      name: 'rate_limit_block_total',
      help: 'Total number of requests blocked by rate limiting',
      labelNames: ['client']
    });

    // Action blocking metrics
    this.actionBlockedTotal = new Counter({
      name: 'action_blocked_total',
      help: 'Total number of actions blocked by policy',
      labelNames: ['policy']
    });

    // Connection metrics
    this.activeConnections = new Gauge({
      name: 'active_connections',
      help: 'Number of active connections'
    });

    // Register all metrics
    register.registerMetric(this.httpRequestDuration);
    register.registerMetric(this.httpRequestTotal);
    register.registerMetric(this.agentLatency);
    register.registerMetric(this.toolCallTotal);
    register.registerMetric(this.agentFallbackTotal);
    register.registerMetric(this.rateLimitBlockTotal);
    register.registerMetric(this.actionBlockedTotal);
    register.registerMetric(this.activeConnections);
  }

  public recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = { method, route, status_code: statusCode.toString() };
    this.httpRequestDuration.observe(labels, durationMs);
    this.httpRequestTotal.inc(labels);
  }

  public recordAgentLatency(agent: string, tool: string, ok: boolean, durationMs: number): void {
    this.agentLatency.observe({ agent, tool, ok: ok.toString() }, durationMs);
  }

  public recordToolCall(tool: string, ok: boolean): void {
    this.toolCallTotal.inc({ tool, ok: ok.toString() });
  }

  public recordAgentFallback(tool: string): void {
    this.agentFallbackTotal.inc({ tool });
  }

  public incrementCounter(metric: string, labels: Record<string, string> = {}): void {
    switch (metric) {
      case 'rate_limit_block_total':
        this.rateLimitBlockTotal.inc(labels);
        break;
      case 'action_blocked_total':
        this.actionBlockedTotal.inc(labels);
        break;
      default:
        break;
    }
  }

  public setActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  public async getPrometheusMetrics(): Promise<string> {
    return register.metrics();
  }

  public startCollection(): void {
    // Start collecting system metrics only if not already started
    try {
      collectDefaultMetrics({ register });
    } catch (error) {
      // Metrics may already be registered, which is fine
      console.log('Default metrics already registered, continuing...');
    }
  }

  public stopCollection(): void {
    register.clear();
  }

  // Get metrics summary for health checks
  public async getMetricsSummary(): Promise<Record<string, any>> {
    const metrics = await register.getMetricsAsJSON();
    const summary: Record<string, any> = {};

    for (const metric of metrics) {
      summary[metric.name] = {
        help: metric.help,
        type: metric.type,
        values: metric.values
      };
    }

    return summary;
  }
}

export default MetricsService;