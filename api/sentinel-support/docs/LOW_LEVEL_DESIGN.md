# Low-Level System Design: Sentinel Support

## Table of Contents

1. [Database Schema Design](#database-schema-design)
2. [API Design & Endpoints](#api-design--endpoints)
3. [Frontend Component Architecture](#frontend-component-architecture)
4. [Real-time Communication Patterns](#real-time-communication-patterns)
5. [Multi-Agent Orchestration](#multi-agent-orchestration)
6. [Performance Optimization Details](#performance-optimization-details)
7. [Error Handling & Resilience](#error-handling--resilience)
8. [Security Implementation](#security-implementation)

---

## Database Schema Design

### Core Tables Structure

```sql
-- Customers table with PII and KYC information
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    address JSONB,
    kyc_status VARCHAR(20) DEFAULT 'pending',
    risk_profile VARCHAR(20) DEFAULT 'medium',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payment cards with masking for PII
CREATE TABLE cards (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    card_number_hash VARCHAR(64) NOT NULL, -- Hashed for security
    card_number_last4 VARCHAR(4) NOT NULL, -- Only last 4 digits stored
    expiry_month INTEGER NOT NULL,
    expiry_year INTEGER NOT NULL,
    card_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    frozen_reason VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transactions with time-based partitioning for performance
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    card_id INTEGER REFERENCES cards(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50) NOT NULL,
    merchant_name VARCHAR(200),
    merchant_category VARCHAR(100),
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,
    settlement_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'pending',
    risk_score DECIMAL(3, 2),
    location JSONB, -- Geographic data
    metadata JSONB, -- Flexible additional data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
) PARTITION BY RANGE (transaction_date);

-- Partitions for transactions (monthly partitions)
CREATE TABLE transactions_2024_01 PARTITION OF transactions
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE transactions_2024_02 PARTITION OF transactions
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
-- ... additional monthly partitions

-- Alerts for transaction monitoring and fraud detection
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    transaction_id BIGINT REFERENCES transactions(id),
    alert_type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    data JSONB, -- Alert-specific data
    status VARCHAR(20) DEFAULT 'open',
    assigned_agent VARCHAR(100),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cases for tracking resolution workflows
CREATE TABLE cases (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES alerts(id),
    customer_id INTEGER REFERENCES customers(id),
    case_type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    assigned_agent VARCHAR(100),
    resolution_summary TEXT,
    actions_taken JSONB[], -- Array of action objects
    timeline JSONB[], -- Array of timeline events
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);
```

### Performance Optimization Indexes

```sql
-- Optimized indexes for query performance
CREATE INDEX CONCURRENTLY idx_transactions_customer_date 
    ON transactions (customer_id, transaction_date DESC);

CREATE INDEX CONCURRENTLY idx_transactions_date_amount 
    ON transactions (transaction_date, amount) 
    WHERE status = 'completed';

CREATE INDEX CONCURRENTLY idx_alerts_priority_status 
    ON alerts (priority, status, created_at DESC);

CREATE INDEX CONCURRENTLY idx_transactions_risk_score 
    ON transactions (risk_score DESC, transaction_date DESC) 
    WHERE risk_score IS NOT NULL;

-- Composite indexes for keyset pagination
CREATE INDEX CONCURRENTLY idx_transactions_keyset 
    ON transactions (transaction_date DESC, id DESC);

CREATE INDEX CONCURRENTLY idx_alerts_keyset 
    ON alerts (priority, created_at DESC, id DESC);
```

### Database Configuration for Performance

```sql
-- PostgreSQL optimization settings
-- postgresql.conf optimizations
shared_buffers = '256MB'              -- 25% of RAM for small instances
effective_cache_size = '1GB'         -- Estimated OS cache
random_page_cost = 1.1                -- SSD optimization
checkpoint_completion_target = 0.9
wal_buffers = '16MB'
default_statistics_target = 100       -- Better query planning
```

---

## API Design & Endpoints

### RESTful API Structure

```typescript
// Base API configuration
interface APIConfig {
  baseURL: string;
  timeout: number;
  rateLimitHeaders: {
    limit: string;
    remaining: string;
    reset: string;
  };
}

// Authentication headers
interface AuthHeaders {
  'Authorization': `Bearer ${string}`;
  'X-API-Key': string;
  'X-Request-ID': string;
  'Content-Type': 'application/json';
}
```

### Core API Endpoints

```typescript
// Transactions API
GET /api/v1/transactions
  Query Parameters:
    - limit: number (default: 50, max: 100)
    - cursor?: string (for keyset pagination)
    - customer_id?: number
    - start_date?: ISO date string
    - end_date?: ISO date string
    - min_amount?: number
    - max_amount?: number
    - status?: 'pending' | 'completed' | 'failed'
    - risk_level?: 'low' | 'medium' | 'high'
  
  Response:
    {
      "data": Transaction[],
      "pagination": {
        "next_cursor": string | null,
        "has_next": boolean,
        "count": number
      },
      "meta": {
        "total_count": number,
        "request_id": string,
        "response_time_ms": number
      }
    }

GET /api/v1/transactions/:id
  Response: Transaction

// Alerts API
GET /api/v1/alerts
  Query Parameters:
    - limit: number (default: 20, max: 100)
    - cursor?: string
    - priority?: 'low' | 'medium' | 'high' | 'critical'
    - status?: 'open' | 'assigned' | 'resolved' | 'closed'
    - assigned_agent?: string
    - alert_type?: string
  
POST /api/v1/alerts/:id/assign
  Body: { "agent": string }

POST /api/v1/alerts/:id/resolve
  Body: { 
    "resolution": string,
    "actions_taken": ActionItem[]
  }

// Multi-Agent Actions API
POST /api/v1/actions/freeze-card
  Body: {
    "card_id": number,
    "reason": string,
    "temporary": boolean,
    "duration_hours"?: number
  }

POST /api/v1/actions/open-dispute
  Body: {
    "transaction_id": number,
    "dispute_reason": string,
    "evidence": Evidence[]
  }

POST /api/v1/actions/contact-customer
  Body: {
    "customer_id": number,
    "communication_type": 'email' | 'sms' | 'phone',
    "template": string,
    "variables": Record<string, any>
  }
```

### Server-Sent Events (SSE) Endpoints

```typescript
// Real-time updates via SSE
GET /api/v1/stream/alerts
  Headers: {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache'
  }
  
  Stream Format:
    event: alert_created
    data: {"alert": Alert, "timestamp": ISO string}
    
    event: alert_updated
    data: {"alert": Alert, "changes": string[], "timestamp": ISO string}
    
    event: action_completed
    data: {"action": Action, "result": ActionResult, "timestamp": ISO string}

GET /api/v1/stream/case/:caseId
  Real-time updates for specific case resolution
```

### API Rate Limiting Implementation

```typescript
interface RateLimitConfig {
  window: number;        // Time window in seconds
  limit: number;         // Max requests per window
  keyGenerator: (req: Request) => string;
}

// Token bucket algorithm implementation
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private capacity: number,
    private refillRate: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  consume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
  
  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (timePassed * this.refillRate)
    );
    this.lastRefill = now;
  }
}
```

---

## Frontend Component Architecture

### Component Hierarchy

```typescript
// Root App component structure
export interface AppStructure {
  App: {
    Layout: {
      Header: {
        SearchBar: Component;
        NotificationCenter: Component;
        UserProfile: Component;
      };
      Sidebar: {
        Navigation: Component;
        QuickStats: Component;
        SystemStatus: Component;
      };
      MainContent: {
        Routes: {
          Dashboard: DashboardPage;
          AlertsQueue: AlertsQueuePage;
          CustomerDetails: CustomerDetailsPage;
          Evaluations: EvaluationsPage;
        };
      };
    };
    TriageDrawer: {
      AlertDetails: Component;
      ActionPanel: Component;
      StreamingUpdates: Component;
      AgentOrchestration: Component;
    };
  };
}
```

### Key Component Implementations

```typescript
// High-performance virtualized table
interface VirtualizedTableProps<T> {
  data: T[];
  columns: ColumnDefinition<T>[];
  height: number;
  itemHeight: number;
  overscan?: number;
  onRowClick?: (item: T) => void;
  loading?: boolean;
}

const VirtualizedTable = <T,>({
  data,
  columns,
  height,
  itemHeight,
  overscan = 5,
  onRowClick,
  loading
}: VirtualizedTableProps<T>) => {
  const [scrollTop, setScrollTop] = useState(0);
  
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(
    startIndex + Math.ceil(height / itemHeight) + overscan,
    data.length
  );
  
  const visibleItems = data.slice(startIndex, endIndex);
  
  return (
    <div 
      className="overflow-auto"
      style={{ height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: data.length * itemHeight }}>
        <div 
          style={{ 
            transform: `translateY(${startIndex * itemHeight}px)` 
          }}
        >
          {visibleItems.map((item, index) => (
            <TableRow 
              key={startIndex + index}
              item={item}
              columns={columns}
              height={itemHeight}
              onClick={() => onRowClick?.(item)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// Memoized table row for performance
const TableRow = React.memo(<T,>({
  item,
  columns,
  height,
  onClick
}: {
  item: T;
  columns: ColumnDefinition<T>[];
  height: number;
  onClick: () => void;
}) => {
  return (
    <div 
      className="flex items-center border-b hover:bg-gray-50 cursor-pointer"
      style={{ height }}
      onClick={onClick}
    >
      {columns.map((column, index) => (
        <div 
          key={index}
          className={cn("px-4", column.className)}
          style={{ width: column.width }}
        >
          {column.render ? column.render(item) : String(item[column.key])}
        </div>
      ))}
    </div>
  );
});
```

### State Management Patterns

```typescript
// React Query configuration for server state
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      retry: (failureCount, error: any) => {
        if (error?.status >= 400 && error?.status < 500) {
          return false; // Don't retry client errors
        }
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// Custom hooks for API integration
export const useAlerts = (params: AlertsQueryParams) => {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => api.alerts.list(params),
    keepPreviousData: true, // For pagination
    refetchInterval: 30000,  // Refresh every 30 seconds
  });
};

export const useAlertActions = () => {
  const queryClient = useQueryClient();
  
  const freezeCard = useMutation({
    mutationFn: api.actions.freezeCard,
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries(['alerts']);
      queryClient.invalidateQueries(['transactions']);
    },
  });
  
  return { freezeCard };
};
```

---

## Real-time Communication Patterns

### Server-Sent Events Implementation

```typescript
// SSE client implementation
class SSEClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  
  connect(url: string, headers: Record<string, string>) {
    this.eventSource = new EventSource(url);
    
    this.eventSource.onopen = () => {
      console.log('SSE connection opened');
      this.reconnectAttempts = 0;
    };
    
    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      this.handleReconnect();
    };
    
    return this.eventSource;
  }
  
  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect(this.url, this.headers);
      }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
    }
  }
  
  disconnect() {
    this.eventSource?.close();
    this.eventSource = null;
  }
}

// React hook for SSE
export const useSSE = (url: string, options: SSEOptions = {}) => {
  const [data, setData] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const sseClient = useRef<SSEClient>();
  
  useEffect(() => {
    sseClient.current = new SSEClient();
    const eventSource = sseClient.current.connect(url, options.headers);
    
    eventSource.addEventListener('message', (event) => {
      const newData = JSON.parse(event.data);
      setData(prev => [newData, ...prev.slice(0, 99)]); // Keep last 100 items
    });
    
    eventSource.addEventListener('open', () => setConnected(true));
    eventSource.addEventListener('error', () => setConnected(false));
    
    return () => {
      sseClient.current?.disconnect();
    };
  }, [url]);
  
  return { data, connected };
};
```

### Backend SSE Implementation

```typescript
// Express SSE endpoint
app.get('/api/v1/stream/alerts', authenticate, (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });
  
  // Send initial connection confirmation
  res.write('data: {"type": "connected", "timestamp": "' + new Date().toISOString() + '"}\n\n');
  
  // Store client connection
  const clientId = uuidv4();
  sseClients.set(clientId, res);
  
  // Send periodic heartbeat
  const heartbeat = setInterval(() => {
    res.write('data: {"type": "heartbeat", "timestamp": "' + new Date().toISOString() + '"}\n\n');
  }, 30000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });
});

// Broadcast function for sending updates to all connected clients
export const broadcastToClients = (event: string, data: any) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  
  sseClients.forEach((res, clientId) => {
    try {
      res.write(payload);
    } catch (error) {
      // Remove dead connections
      sseClients.delete(clientId);
    }
  });
};
```

---

## Multi-Agent Orchestration

### Agent Architecture

```typescript
interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  executionTime: number; // Estimated execution time in ms
  dependencies: string[]; // Other agents this depends on
  execute(context: AgentContext): Promise<AgentResult>;
}

interface AgentContext {
  alertId: string;
  customerId: number;
  transactionData?: Transaction;
  customerData?: Customer;
  additionalData?: Record<string, any>;
}

interface AgentResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  logs: LogEntry[];
}

// Fraud Detection Agent
class FraudDetectionAgent implements Agent {
  id = 'fraud-detector';
  name = 'Fraud Detection Agent';
  capabilities = ['risk-assessment', 'pattern-analysis'];
  executionTime = 500;
  dependencies = [];
  
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      // Analyze transaction patterns
      const riskScore = await this.analyzeTransactionRisk(context);
      const fraudProbability = await this.calculateFraudProbability(context);
      
      return {
        success: true,
        data: {
          riskScore,
          fraudProbability,
          recommendation: this.getRecommendation(riskScore, fraudProbability)
        },
        executionTime: Date.now() - startTime,
        logs: [
          { level: 'info', message: 'Risk analysis completed', timestamp: new Date() }
        ]
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
        logs: [
          { level: 'error', message: `Fraud detection failed: ${error.message}`, timestamp: new Date() }
        ]
      };
    }
  }
  
  private async analyzeTransactionRisk(context: AgentContext): Promise<number> {
    // Risk scoring logic
    return Math.random() * 10; // Simplified for example
  }
}

// Card Management Agent
class CardManagementAgent implements Agent {
  id = 'card-manager';
  name = 'Card Management Agent';
  capabilities = ['freeze-card', 'unfreeze-card', 'replace-card'];
  executionTime = 1000;
  dependencies = ['fraud-detector'];
  
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      // Get fraud detection results
      const fraudResults = context.additionalData?.fraudDetection;
      
      if (fraudResults?.riskScore > 7) {
        await this.freezeCard(context.customerId);
        return {
          success: true,
          data: { action: 'card_frozen', reason: 'high_risk_transaction' },
          executionTime: Date.now() - startTime,
          logs: [
            { level: 'info', message: 'Card frozen due to high risk', timestamp: new Date() }
          ]
        };
      }
      
      return {
        success: true,
        data: { action: 'no_action', reason: 'low_risk' },
        executionTime: Date.now() - startTime,
        logs: []
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
        logs: [
          { level: 'error', message: `Card management failed: ${error.message}`, timestamp: new Date() }
        ]
      };
    }
  }
  
  private async freezeCard(customerId: number): Promise<void> {
    // Card freezing logic
  }
}
```

### Orchestrator Implementation

```typescript
class MultiAgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private executionState: Map<string, ExecutionState> = new Map();
  
  registerAgent(agent: Agent) {
    this.agents.set(agent.id, agent);
  }
  
  async executeWorkflow(
    workflowId: string,
    agentIds: string[],
    context: AgentContext
  ): Promise<WorkflowResult> {
    const executionPlan = this.createExecutionPlan(agentIds);
    const results: Map<string, AgentResult> = new Map();
    
    // Update execution state
    this.executionState.set(workflowId, {
      status: 'running',
      startTime: new Date(),
      totalAgents: agentIds.length,
      completedAgents: 0
    });
    
    // Execute agents in dependency order
    for (const batch of executionPlan) {
      await Promise.all(
        batch.map(async (agentId) => {
          const agent = this.agents.get(agentId);
          if (!agent) throw new Error(`Agent ${agentId} not found`);
          
          // Prepare context with previous agent results
          const enhancedContext = {
            ...context,
            additionalData: this.buildAdditionalData(results, agent.dependencies)
          };
          
          try {
            const result = await agent.execute(enhancedContext);
            results.set(agentId, result);
            
            // Broadcast progress update
            this.broadcastProgress(workflowId, agentId, result);
            
            // Update execution state
            const state = this.executionState.get(workflowId);
            if (state) {
              state.completedAgents++;
            }
          } catch (error) {
            results.set(agentId, {
              success: false,
              error: error.message,
              executionTime: 0,
              logs: [{ level: 'error', message: error.message, timestamp: new Date() }]
            });
          }
        })
      );
    }
    
    // Mark workflow as completed
    const finalState = this.executionState.get(workflowId);
    if (finalState) {
      finalState.status = 'completed';
      finalState.endTime = new Date();
    }
    
    return {
      workflowId,
      success: Array.from(results.values()).every(r => r.success),
      results: Object.fromEntries(results),
      totalExecutionTime: Date.now() - (finalState?.startTime?.getTime() || 0)
    };
  }
  
  private createExecutionPlan(agentIds: string[]): string[][] {
    // Topological sort based on dependencies
    const plan: string[][] = [];
    const remaining = new Set(agentIds);
    
    while (remaining.size > 0) {
      const batch = [];
      
      for (const agentId of remaining) {
        const agent = this.agents.get(agentId);
        if (!agent) continue;
        
        // Check if all dependencies are satisfied
        const dependenciesSatisfied = agent.dependencies.every(dep => 
          !remaining.has(dep)
        );
        
        if (dependenciesSatisfied) {
          batch.push(agentId);
        }
      }
      
      if (batch.length === 0) {
        throw new Error('Circular dependency detected in agent workflow');
      }
      
      batch.forEach(agentId => remaining.delete(agentId));
      plan.push(batch);
    }
    
    return plan;
  }
  
  private broadcastProgress(workflowId: string, agentId: string, result: AgentResult) {
    broadcastToClients('agent_completed', {
      workflowId,
      agentId,
      result,
      timestamp: new Date().toISOString()
    });
  }
}
```

---

## Performance Optimization Details

### Database Optimization Strategies

```typescript
// Keyset pagination implementation
interface KeysetPaginationParams {
  limit: number;
  cursor?: string; // Base64 encoded cursor
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

class KeysetPagination {
  static generateCursor(item: any, sortField: string): string {
    const cursorData = {
      [sortField]: item[sortField],
      id: item.id
    };
    return Buffer.from(JSON.stringify(cursorData)).toString('base64');
  }
  
  static parseCursor(cursor: string): any {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch {
      throw new Error('Invalid cursor format');
    }
  }
  
  static buildQuery(params: KeysetPaginationParams): string {
    const { limit, cursor, sortField, sortDirection } = params;
    
    let whereClause = '';
    if (cursor) {
      const cursorData = this.parseCursor(cursor);
      const operator = sortDirection === 'desc' ? '<' : '>';
      
      whereClause = `
        WHERE (
          ${sortField} ${operator} $1 
          OR (${sortField} = $1 AND id ${operator} $2)
        )
      `;
    }
    
    return `
      SELECT * FROM transactions 
      ${whereClause}
      ORDER BY ${sortField} ${sortDirection.toUpperCase()}, id ${sortDirection.toUpperCase()}
      LIMIT ${limit + 1}
    `;
  }
}

// Connection pooling configuration
const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,                    // Maximum connections in pool
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Return error after 2s if no connection available
  maxUses: 7500,             // Close connection after 7500 uses (prevent memory leaks)
};
```

### Frontend Performance Optimization

```typescript
// Virtual scrolling implementation for large datasets
interface VirtualScrollProps {
  items: any[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: any, index: number) => React.ReactNode;
  overscan?: number;
}

const VirtualScroll: React.FC<VirtualScrollProps> = ({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.min(
    visibleStart + Math.ceil(containerHeight / itemHeight) + overscan,
    items.length
  );
  
  const totalHeight = items.length * itemHeight;
  const offsetY = visibleStart * itemHeight;
  
  return (
    <div 
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {items.slice(visibleStart, visibleEnd).map((item, index) => (
            <div key={visibleStart + index} style={{ height: itemHeight }}>
              {renderItem(item, visibleStart + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Memoization patterns for expensive computations
const ExpensiveComponent = React.memo(({ data, filters }) => {
  const processedData = useMemo(() => {
    return data
      .filter(item => filters.some(filter => filter(item)))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(item => ({
        ...item,
        formattedAmount: formatCurrency(item.amount),
        relativeDate: formatRelativeTime(new Date(item.date))
      }));
  }, [data, filters]);
  
  return (
    <div>
      {processedData.map(item => (
        <ItemComponent key={item.id} item={item} />
      ))}
    </div>
  );
});

// Code splitting for route-based chunks
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AlertsQueue = lazy(() => import('./pages/AlertsQueue'));
const CustomerDetails = lazy(() => import('./pages/CustomerDetails'));

// Preload critical routes
const preloadRoutes = () => {
  import('./pages/AlertsQueue'); // Most frequently accessed after dashboard
  import('./components/TriageDrawer'); // Critical for workflow
};

// Call preload after initial render
useEffect(() => {
  const timer = setTimeout(preloadRoutes, 1000);
  return () => clearTimeout(timer);
}, []);
```

---

## Error Handling & Resilience

### Frontend Error Boundaries

```typescript
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ComponentType<any> },
  ErrorBoundaryState
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log error to monitoring service
    logger.error('React Error Boundary caught error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString()
    });
    
    // Send to external monitoring (Sentry, DataDog, etc.)
    if (process.env.NODE_ENV === 'production') {
      sentryCapture(error, { extra: errorInfo });
    }
  }
  
  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return <FallbackComponent error={this.state.error} />;
    }
    
    return this.props.children;
  }
}
```

### Backend Error Handling

```typescript
// Centralized error handler
interface APIError extends Error {
  statusCode: number;
  code: string;
  details?: any;
}

class APIErrorHandler {
  static handle(error: any, req: Request, res: Response, next: NextFunction) {
    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details = {};
    
    // Handle different error types
    if (error instanceof ValidationError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = error.details;
    } else if (error instanceof DatabaseError) {
      statusCode = 500;
      code = 'DATABASE_ERROR';
      message = 'Database operation failed';
    } else if (error instanceof AuthenticationError) {
      statusCode = 401;
      code = 'AUTHENTICATION_ERROR';
      message = 'Authentication failed';
    } else if (error instanceof AuthorizationError) {
      statusCode = 403;
      code = 'AUTHORIZATION_ERROR';
      message = 'Insufficient permissions';
    }
    
    // Log error
    logger.error('API Error', {
      statusCode,
      code,
      message,
      error: error.message,
      stack: error.stack,
      requestId: req.headers['x-request-id'],
      url: req.url,
      method: req.method,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    });
    
    // Send error response
    res.status(statusCode).json({
      error: {
        code,
        message,
        details: process.env.NODE_ENV === 'development' ? details : undefined,
        requestId: req.headers['x-request-id'],
        timestamp: new Date().toISOString()
      }
    });
  }
}

// Circuit breaker pattern for external services
class CircuitBreaker {
  private failureCount = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttempt = 0;
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private monitoringPeriod: number = 120000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
```

---

## Security Implementation

### Authentication & Authorization

```typescript
// JWT token validation middleware
interface JWTPayload {
  userId: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}

const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    
    // Check token expiration
    if (Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Role-based authorization
const authorize = (requiredPermissions: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userPermissions = req.user?.permissions || [];
    
    const hasPermission = requiredPermissions.every(permission =>
      userPermissions.includes(permission)
    );
    
    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: requiredPermissions 
      });
    }
    
    next();
  };
};
```

### PII Redaction Implementation

```typescript
interface PIIRedactionConfig {
  fields: {
    [key: string]: {
      type: 'mask' | 'hash' | 'remove';
      pattern?: RegExp;
      replacement?: string;
    };
  };
}

class PIIRedactor {
  private config: PIIRedactionConfig = {
    fields: {
      email: { type: 'mask', pattern: /(.{2})(.*)(@.*)/, replacement: '$1***$3' },
      phone: { type: 'mask', pattern: /(\d{3})(\d{3})(\d{4})/, replacement: '$1-***-$3' },
      ssn: { type: 'hash' },
      credit_card: { type: 'mask', pattern: /(\d{4})(\d{8})(\d{4})/, replacement: '$1-****-****-$3' },
      address: { type: 'remove' }
    }
  };
  
  redact(data: any, level: 'INTERNAL' | 'EXTERNAL' = 'EXTERNAL'): any {
    if (typeof data !== 'object' || data === null) return data;
    
    const redacted = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      const fieldConfig = this.config.fields[key.toLowerCase()];
      
      if (fieldConfig && level === 'EXTERNAL') {
        redacted[key] = this.redactField(value, fieldConfig);
      } else if (typeof value === 'object') {
        redacted[key] = this.redact(value, level);
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }
  
  private redactField(value: any, config: any): any {
    if (typeof value !== 'string') return value;
    
    switch (config.type) {
      case 'mask':
        return config.pattern 
          ? value.replace(config.pattern, config.replacement)
          : '***';
      case 'hash':
        return crypto.createHash('sha256').update(value).digest('hex').substring(0, 8);
      case 'remove':
        return '[REDACTED]';
      default:
        return value;
    }
  }
}

// Usage in API responses
app.use((req, res, next) => {
  const originalJson = res.json;
  const redactor = new PIIRedactor();
  
  res.json = function(obj) {
    const redactionLevel = req.headers['x-data-level'] === 'internal' 
      ? 'INTERNAL' 
      : 'EXTERNAL';
    
    const redactedData = redactor.redact(obj, redactionLevel);
    return originalJson.call(this, redactedData);
  };
  
  next();
});
```

### Rate Limiting Implementation

```typescript
interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator: (req: Request) => string;
}

class RateLimiter {
  private store = new Map<string, { count: number; resetTime: number }>();
  
  constructor(private rules: RateLimitRule[]) {}
  
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const rule = this.selectRule(req);
      const key = rule.keyGenerator(req);
      const now = Date.now();
      
      let bucket = this.store.get(key);
      
      if (!bucket || now > bucket.resetTime) {
        bucket = {
          count: 0,
          resetTime: now + rule.windowMs
        };
        this.store.set(key, bucket);
      }
      
      if (bucket.count >= rule.maxRequests) {
        const retryAfter = Math.ceil((bucket.resetTime - now) / 1000);
        
        res.set({
          'X-RateLimit-Limit': rule.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(bucket.resetTime).toISOString(),
          'Retry-After': retryAfter.toString()
        });
        
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: retryAfter
        });
      }
      
      bucket.count++;
      
      res.set({
        'X-RateLimit-Limit': rule.maxRequests.toString(),
        'X-RateLimit-Remaining': (rule.maxRequests - bucket.count).toString(),
        'X-RateLimit-Reset': new Date(bucket.resetTime).toISOString()
      });
      
      next();
    };
  }
  
  private selectRule(req: Request): RateLimitRule {
    // Return appropriate rule based on endpoint, user role, etc.
    return this.rules[0]; // Simplified
  }
}
```

This comprehensive low-level design covers all the critical implementation details needed to build the Sentinel Support platform with production-quality code, performance optimizations, security measures, and resilience patterns.