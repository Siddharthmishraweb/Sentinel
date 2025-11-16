import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 8000;

// Enable CORS
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json());

// Mock data
const mockTransactions = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  customer_id: Math.floor(Math.random() * 1000) + 1,
  card_id: Math.floor(Math.random() * 5000) + 1,
  amount: Math.floor(Math.random() * 10000) + 100,
  currency: 'USD',
  transaction_type: ['purchase', 'withdrawal', 'transfer', 'deposit'][Math.floor(Math.random() * 4)],
  merchant_name: ['Amazon', 'Walmart', 'Target', 'Starbucks', 'Gas Station'][Math.floor(Math.random() * 5)],
  merchant_category: ['retail', 'food', 'gas', 'online'][Math.floor(Math.random() * 4)],
  transaction_date: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString(),
  status: ['completed', 'pending', 'failed'][Math.floor(Math.random() * 3)],
  risk_score: Math.floor(Math.random() * 100),
  location: {
    city: 'New York',
    country: 'US'
  }
}));

const mockAlerts = Array.from({ length: 20 }, (_, i) => ({
  id: `alert-${i + 1}`,
  title: [
    'High-risk transaction detected',
    'Suspicious login activity',
    'Multiple failed payment attempts',
    'Unusual spending pattern',
    'Account verification needed'
  ][Math.floor(Math.random() * 5)],
  description: 'Alert description details here',
  priority: ['critical', 'high', 'medium', 'low'][Math.floor(Math.random() * 4)],
  status: ['open', 'assigned', 'resolved', 'closed'][Math.floor(Math.random() * 4)],
  type: ['fraud', 'compliance', 'security', 'risk'][Math.floor(Math.random() * 4)],
  customer_id: Math.floor(Math.random() * 1000) + 1,
  transaction_id: Math.floor(Math.random() * 50) + 1,
  assigned_agent: Math.random() > 0.5 ? 'Agent Smith' : null,
  created_at: new Date(Date.now() - Math.floor(Math.random() * 7) * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString()
}));

const mockCustomers = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  external_id: `cust-${i + 1}`,
  email: `customer${i + 1}@example.com`,
  phone: `+1-555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
  first_name: ['John', 'Jane', 'Bob', 'Alice', 'Charlie'][Math.floor(Math.random() * 5)],
  last_name: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'][Math.floor(Math.random() * 5)],
  kyc_status: ['verified', 'pending', 'rejected'][Math.floor(Math.random() * 3)],
  risk_profile: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
  created_at: new Date(Date.now() - Math.floor(Math.random() * 365) * 24 * 60 * 60 * 1000).toISOString()
}));

// API Routes
app.get('/api/v1/transactions', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  
  const paginatedTransactions = mockTransactions.slice(offset, offset + limit);
  
  res.json({
    data: paginatedTransactions,
    pagination: {
      has_next: offset + limit < mockTransactions.length,
      count: paginatedTransactions.length
    },
    meta: {
      total_count: mockTransactions.length,
      request_id: `req-${Date.now()}`,
      response_time_ms: 50
    }
  });
});

app.get('/api/v1/transactions/metrics', (req, res) => {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  
  res.json({
    data: {
      total_transactions: mockTransactions.length,
      total_amount: mockTransactions.reduce((sum, t) => sum + t.amount, 0),
      average_amount: mockTransactions.reduce((sum, t) => sum + t.amount, 0) / mockTransactions.length,
      high_risk_count: mockTransactions.filter(t => t.risk_score && t.risk_score > 80).length,
      success_rate: 0.95,
      growth_rate: 0.12
    }
  });
});

app.get('/api/v1/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  
  const paginatedAlerts = mockAlerts.slice(offset, offset + limit);
  
  res.json({
    data: paginatedAlerts,
    pagination: {
      has_next: offset + limit < mockAlerts.length,
      count: paginatedAlerts.length
    },
    meta: {
      total_count: mockAlerts.length,
      request_id: `req-${Date.now()}`,
      response_time_ms: 30
    }
  });
});

app.get('/api/v1/customers/:id', (req, res) => {
  const customerId = parseInt(req.params.id);
  const customer = mockCustomers.find(c => c.id === customerId);
  
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  
  // Get customer's transactions
  const customerTransactions = mockTransactions.filter(t => t.customer_id === customerId);
  
  res.json({
    data: {
      ...customer,
      transactions: customerTransactions
    }
  });
});

app.post('/api/v1/alerts/:id/assign', (req, res) => {
  const alertId = req.params.id;
  const { agent_id } = req.body;
  
  const alert = mockAlerts.find(a => a.id === alertId);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }
  
  alert.assigned_agent = agent_id || 'Current Agent';
  alert.status = 'assigned';
  alert.updated_at = new Date().toISOString();
  
  res.json({ data: alert });
});

app.post('/api/v1/alerts/:id/resolve', (req, res) => {
  const alertId = req.params.id;
  
  const alert = mockAlerts.find(a => a.id === alertId);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }
  
  alert.status = 'resolved';
  alert.updated_at = new Date().toISOString();
  
  res.json({ data: alert });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Mock API Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Transactions: http://localhost:${PORT}/api/v1/transactions`);
  console.log(`🚨 Alerts: http://localhost:${PORT}/api/v1/alerts`);
});