import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Base URL resolution:
// 1. Prefer explicit VITE_API_URL (e.g. http://localhost:3002/api/v1)
// 2. If only host given (http://localhost:3002), append /api/v1
// 3. Fallback to vite dev proxy path '/api/v1' (proxy forwards to backend)
// Vite exposes import.meta.env with typing via vite-env.d.ts; cast to any to avoid TS complaints in isolated file
const rawEnvBase = (import.meta as any).env?.VITE_API_URL as string | undefined

console.log("rawEnvBase =------------- ", rawEnvBase)
let API_BASE_URL = '/api/v1'
if (rawEnvBase) {
  // Normalize to include /api/v1
  if (/\/api\/v1\/?$/.test(rawEnvBase)) {
    API_BASE_URL = rawEnvBase.replace(/\/$/, '')
  } else if (/\/api\/?$/.test(rawEnvBase)) {
    API_BASE_URL = rawEnvBase.replace(/\/$/, '') + '/v1'
  } else {
    API_BASE_URL = rawEnvBase.replace(/\/$/, '') + '/api/v1'
  }
}

interface Alert {
  id: string
  customer_id: string
  suspect_txn_id?: string
  risk_score: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED'
  reasons: string[]
  created_at: string
  updated_at?: string
  assigned_agent?: string
  customer_name?: string
}

interface Transaction {
  id: string
  customer_id: string
  card_id: string
  amount_cents: number
  currency: string
  merchant: string
  mcc: string
  transaction_date: string
  status: string
  created_at: string
  customer_name?: string
}

interface Customer {
  id: number
  external_id: string
  email: string
  phone?: string
  first_name: string
  last_name: string
  kyc_status: string
  risk_profile: string
  created_at: string
}

// Insights types
interface CustomerInsightsSummary {
  categories?: Array<{ name: string; percentage: number }>
  merchants?: Array<{ name: string; total_spend: number; transaction_count: number }>
  anomalies?: Array<{ type: string; description: string; detected_at: string }>
  monthlyTrend?: Array<{ month: string; total_spend: number; transaction_count: number }>
  totals?: { total_spend: number; transaction_count: number; average_ticket: number }
}

interface Evaluation {
  id: number
  name: string
  description: string
  status: 'completed' | 'running' | 'pending'
  lastRun: string
  score?: number
  testCases: number
  createdAt?: string
  updatedAt?: string
}

interface ApiResponse<T> {
  data: T[]
  pagination?: {
    next_cursor?: string
    has_next: boolean
    count: number
  }
  meta?: {
    total_count: number
    request_id: string
    response_time_ms: number
  }
}

// API client with authentication
class APIClient {
  private baseURL = API_BASE_URL
  private headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-API-Key': 'sentinel-api-key-2024', // Match backend .env API_KEY
  }

  async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Prevent double prefix when base ends with /api/v1 and endpoint also starts with /api/v1
    const normalizedEndpoint = (this.baseURL.endsWith('/api/v1') && endpoint.startsWith('/api/v1'))
      ? endpoint.replace(/^\/api\/v1/, '')
      : endpoint
    const url = `${this.baseURL}${normalizedEndpoint}`
    const config: RequestInit = {
      headers: this.headers,
      ...options,
    }

    const response = await fetch(url, config)
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    // Normalize duplicate version path
    const normalizedEndpoint = (this.baseURL.endsWith('/api/v1') && endpoint.startsWith('/api/v1'))
      ? endpoint.replace(/^\/api\/v1/, '')
      : endpoint
    const base = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL
    const fullPath = base + (normalizedEndpoint.startsWith('/') ? normalizedEndpoint : `/${normalizedEndpoint}`)
    const url = new URL(fullPath)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value))
        }
      })
    }
    return this.fetch(url.pathname + url.search)
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.fetch(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.fetch(endpoint, {
      method: 'DELETE',
    })
  }
}

export const apiClient = new APIClient()

// Alert hooks
export const useAlerts = (params?: {
  priority?: string
  status?: string
  cursor?: string
  limit?: number
}) => {

  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => apiClient.get<ApiResponse<Alert>>('/alerts', params),
    refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
    staleTime: 10000, // Consider data stale after 10 seconds
  })
}

export const useAlert = (alertId: string) => {
  return useQuery({
    queryKey: ['alert', alertId],
    queryFn: () => apiClient.get<Alert>(`/api/v1/alerts/${alertId}`),
    enabled: !!alertId,
  })
}

export const useAssignAlert = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ alertId, agent }: { alertId: string; agent: string }) =>
      apiClient.post(`/api/v1/alerts/${alertId}/assign`, { agent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}

export const useResolveAlert = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ 
      alertId, 
      resolution, 
      actions 
    }: { 
      alertId: string
      resolution: string
      actions: any[]
    }) =>
      apiClient.post(`/api/v1/alerts/${alertId}/resolve`, { 
        resolution, 
        actions_taken: actions 
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}

// Transaction hooks
export const useTransactions = (params?: {
  customer_id?: number
  start_date?: string
  end_date?: string
  cursor?: string
  limit?: number
  min_amount?: number
  max_amount?: number
  status?: string
}) => {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => apiClient.get<ApiResponse<Transaction>>('/api/v1/transactions', params),
    staleTime: 60000, // Transactions are less frequently updated
  })
}

export const useTransaction = (transactionId: number) => {
  return useQuery({
    queryKey: ['transaction', transactionId],
    queryFn: () => apiClient.get<Transaction>(`/api/v1/transactions/${transactionId}`),
    enabled: !!transactionId,
  })
}

// Customer hooks
export const useCustomers = (params?: {
  search?: string
  cursor?: string
  limit?: number
}) => {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => apiClient.get<ApiResponse<Customer>>('/api/v1/customers', params),
    staleTime: 300000, // Customer data is relatively stable
  })
}

export const useCustomer = (customerId: number) => {
  return useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => apiClient.get<Customer>(`/api/v1/customers/${customerId}`),
    enabled: !!customerId,
  })
}

// Customer stats hook (active cards, transactions, open alerts)
export const useCustomerStats = (customerId: number) => {
  return useQuery({
    queryKey: ['customer-stats', customerId],
    queryFn: () => apiClient.get<{ success: boolean; customerId: string; stats: { active_cards: number; transaction_count: number; open_alerts: number }; timestamp: string }>(`/api/v1/customers/${customerId}/stats`),
    enabled: !!customerId,
    staleTime: 60_000
  })
}

// Insights summary hook
export const useCustomerInsightsSummary = (customerId: number, lastDays: number = 90) => {
  return useQuery({
    queryKey: ['customer-insights-summary', customerId, lastDays],
    queryFn: () => apiClient.get<{ success: boolean; customerId: string; summary: CustomerInsightsSummary; generated_at: string }>(`/insights/${customerId}/summary`, { lastDays }),
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000
  })
}

// Multi-agent action hooks
export const useFreezeCard = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (params: {
      card_id: number
      reason: string
      temporary?: boolean
      duration_hours?: number
    }) =>
      apiClient.post('/api/v1/actions/freeze-card', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export const useOpenDispute = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (params: {
      transaction_id: number
      dispute_reason: string
      evidence: any[]
    }) =>
      apiClient.post('/api/v1/actions/open-dispute', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export const useContactCustomer = () => {
  return useMutation({
    mutationFn: (params: {
      customer_id: number
      communication_type: 'email' | 'sms' | 'phone'
      template: string
      variables: Record<string, any>
    }) =>
      apiClient.post('/api/v1/actions/contact-customer', params),
  })
}

// Dashboard metrics hook
export const useDashboardMetrics = () => {
  return useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: () => apiClient.get('/api/v1/dashboard/metrics'),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000,
  })
}

// Health check hook
export const useHealthCheck = () => {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get('/api/v1/health'),
    refetchInterval: 30000,
    retry: false, // Don't retry health checks
  })
}

// Evaluations hooks
export const useEvaluations = (params?: {
  page?: number
  limit?: number
  status?: string
  sort?: string
  order?: 'asc' | 'desc'
}) => {
  return useQuery({
    queryKey: ['evaluations', params],
    queryFn: () => apiClient.get<{
      evaluations: Evaluation[]
      pagination: {
        page: number
        limit: number
        total: number
        totalPages: number
      }
      summary: {
        totalEvaluations: number
        averageScore: number
        activeTests: number
      }
    }>('/api/v1/evaluations', params),
    staleTime: 30000, // Evaluations change moderately
  })
}

export const useEvaluation = (evaluationId: number) => {
  return useQuery({
    queryKey: ['evaluation', evaluationId],
    queryFn: () => apiClient.get<Evaluation>(`/api/v1/evaluations/${evaluationId}`),
    enabled: !!evaluationId,
  })
}

export const useRunEvaluation = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (evaluationId: number) =>
      apiClient.post(`/api/v1/evaluations/${evaluationId}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evaluations'] })
    },
  })
}