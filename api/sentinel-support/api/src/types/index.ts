export type CardStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED' | 'PENDING';
export type AlertStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';
export type CaseStatus = 'OPEN' | 'PENDING_CUSTOMER' | 'PENDING_MERCHANT' | 'RESOLVED' | 'CLOSED';
export type CaseType = 'DISPUTE' | 'FRAUD' | 'INQUIRY' | 'CHARGEBACK';
export type KYCLevel = 'BASIC' | 'ENHANCED' | 'PREMIUM';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// Base entity interface
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
}

// Customer interfaces
export interface Customer extends BaseEntity {
  name: string;
  emailMasked: string;
  kycLevel: KYCLevel;
  metadata?: Record<string, any>;
}

export interface Card extends BaseEntity {
  customerId: string;
  last4: string;
  network: string;
  status: CardStatus;
  frozenAt?: Date;
  frozenBy?: string;
  metadata?: Record<string, any>;
}

export interface Account extends BaseEntity {
  customerId: string;
  balanceCents: number;
  currency: string;
}

// Transaction interface
export interface Transaction extends BaseEntity {
  customerId: string;
  cardId?: string;
  accountId?: string;
  mcc: string;
  merchant: string;
  amountCents: number;
  currency: string;
  ts: Date;
  deviceId?: string;
  country?: string;
  city?: string;
  authCode?: string;
  referenceId?: string;
  status?: string;
  metadata?: Record<string, any>;
}

// Alert interfaces
export interface Alert extends BaseEntity {
  customerId: string;
  suspectTxnId?: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: string[];
  status: AlertStatus;
  resolvedAt?: Date;
  resolvedBy?: string;
  metadata?: Record<string, any>;
}

// Case interfaces
export interface Case extends BaseEntity {
  customerId: string;
  txnId?: string;
  alertId?: string;
  type: CaseType;
  status: CaseStatus;
  reasonCode?: string;
  amountCents?: number;
  resolvedAt?: Date;
  assignedTo?: string;
  priority?: number;
  description?: string;
  metadata?: Record<string, any>;
}

export interface CaseEvent {
  id: string;
  caseId: string;
  ts: Date;
  actor: string;
  action: string;
  payloadJson?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

// Triage interfaces
export interface TriageRun {
  id: string;
  alertId: string;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  riskLevel?: RiskLevel;
  reasons?: string[];
  recommendedAction?: string;
  fallbackUsed: boolean;
  agentVersion?: string;
  metadata?: Record<string, any>;
}

export interface AgentTrace {
  runId: string;
  seq: number;
  step: string;
  agent: string;
  tool?: string;
  ok: boolean;
  durationMs: number;
  detailJson?: Record<string, any>;
  errorMessage?: string;
  retryCount: number;
  startedAt: Date;
  endedAt?: Date;
}

// Knowledge base interfaces
export interface KBDoc {
  id: string;
  title: string;
  anchor?: string;
  contentText: string;
  category?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface Policy {
  id: string;
  code: string;
  title: string;
  contentText: string;
  active: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// Device interface
export interface Device {
  id: string;
  deviceId: string;
  customerId?: string;
  fingerprint?: string;
  firstSeen: Date;
  lastSeen: Date;
  riskScore: number;
  isTrusted: boolean;
  metadata?: Record<string, any>;
}

// API Response types
export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}

export interface CustomerSummary {
  id: string;
  name: string;
  emailMasked: string;
  kycLevel: KYCLevel;
  cardCount: number;
  accountCount: number;
  totalBalanceCents: number;
  transactionCount: number;
  openAlerts: number;
  createdAt: Date;
}

export interface AlertQueueItem {
  id: string;
  customerId: string;
  customerName: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: string[];
  status: AlertStatus;
  createdAt: Date;
  merchant?: string;
  amountCents?: number;
  currency?: string;
  transactionTs?: Date;
  triageRunId?: string;
  recommendedAction?: string;
}

// Insights interfaces
export interface TransactionInsights {
  topMerchants: Array<{ merchant: string; count: number; amountCents: number }>;
  categories: Array<{ name: string; pct: number; amountCents: number }>;
  monthlyTrend: Array<{ month: string; sum: number; count: number }>;
  anomalies: Array<{ ts: Date; z: number; note: string; amountCents: number }>;
  velocityMetrics: {
    dailyAvg: number;
    weeklyAvg: number;
    currentWeek: number;
  };
  deviceMetrics: {
    uniqueDevices: number;
    newDevices: number;
    suspiciousDevices: number;
  };
}

// Triage interfaces
export interface TriageRequest {
  alertId: string;
  options?: {
    enableLLM?: boolean;
    timeoutMs?: number;
    skipCache?: boolean;
  };
}

export interface TriageResponse {
  runId: string;
  alertId: string;
  status: 'STARTED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export interface TriageEvent {
  type: 'plan_built' | 'tool_update' | 'fallback_triggered' | 'decision_finalized' | 'error';
  runId: string;
  timestamp: Date;
  data: Record<string, any>;
}

// Action interfaces
export interface FreezeCardRequest {
  cardId: string;
  otp?: string;
}

export interface FreezeCardResponse {
  status: 'PENDING_OTP' | 'FROZEN';
  requestId: string;
  otpRequired?: boolean;
}

export interface OpenDisputeRequest {
  txnId: string;
  reasonCode: string;
  confirm: boolean;
  description?: string;
}

export interface OpenDisputeResponse {
  caseId: string;
  status: 'OPEN';
  requestId: string;
}

// Search interfaces
export interface KBSearchRequest {
  q: string;
  limit?: number;
  category?: string;
}

export interface KBSearchResult {
  docId: string;
  title: string;
  anchor?: string;
  extract: string;
  score: number;
  category?: string;
}

export interface KBSearchResponse {
  results: KBSearchResult[];
  total: number;
  queryTime: number;
}

// Metrics interfaces
export interface SystemMetrics {
  apiRequestLatencyMs: Record<string, number>;
  agentLatencyMs: Record<string, number>;
  toolCallTotal: Record<string, number>;
  agentFallbackTotal: Record<string, number>;
  rateLimitBlockTotal: number;
  actionBlockedTotal: Record<string, number>;
  activeConnections: number;
  memoryUsage: number;
  cpuUsage: number;
}

// Error interfaces
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
  requestId?: string;
  timestamp: Date;
}

// Authentication interfaces
export interface AuthContext {
  userId: string;
  role: 'agent' | 'lead' | 'admin';
  permissions: string[];
  sessionId: string;
}

// Configuration interfaces
export interface AgentConfig {
  tools: {
    timeout: number;
    retries: number;
    circuitBreaker: {
      threshold: number;
      timeoutMs: number;
    };
  };
  flow: {
    budgetMs: number;
    defaultPlan: string[];
  };
  llm: {
    enabled: boolean;
    model?: string;
    apiUrl?: string;
  };
}