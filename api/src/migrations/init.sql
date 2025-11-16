-- Sentinel Support Database Schema
-- PostgreSQL 15+ compatible

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom types
CREATE TYPE card_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED', 'PENDING');
CREATE TYPE alert_status AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');
CREATE TYPE case_status AS ENUM ('OPEN', 'PENDING_CUSTOMER', 'PENDING_MERCHANT', 'RESOLVED', 'CLOSED');
CREATE TYPE case_type AS ENUM ('DISPUTE', 'FRAUD', 'INQUIRY', 'CHARGEBACK');
CREATE TYPE kyc_level AS ENUM ('BASIC', 'ENHANCED', 'PREMIUM');
CREATE TYPE risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Customers table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email_masked VARCHAR(255) NOT NULL,
    kyc_level kyc_level NOT NULL DEFAULT 'BASIC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT customers_email_valid CHECK (email_masked ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Cards table
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    last4 VARCHAR(4) NOT NULL,
    network VARCHAR(20) NOT NULL,
    status card_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    frozen_at TIMESTAMPTZ,
    frozen_by VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT cards_last4_valid CHECK (last4 ~ '^[0-9]{4}$'),
    CONSTRAINT cards_network_valid CHECK (network IN ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'))
);

-- Accounts table
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT accounts_currency_valid CHECK (currency ~ '^[A-Z]{3}$')
);

-- Transactions table (optimized for high volume)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    card_id UUID REFERENCES cards(id),
    account_id UUID REFERENCES accounts(id),
    
    -- Transaction details
    mcc VARCHAR(4) NOT NULL,
    merchant VARCHAR(255) NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    
    -- Location and timing
    ts TIMESTAMPTZ NOT NULL,
    device_id VARCHAR(255),
    country VARCHAR(2),
    city VARCHAR(100),
    
    -- Additional metadata
    auth_code VARCHAR(10),
    reference_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'COMPLETED',
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT transactions_mcc_valid CHECK (mcc ~ '^[0-9]{4}$'),
    CONSTRAINT transactions_country_valid CHECK (country ~ '^[A-Z]{2}$' OR country IS NULL),
    CONSTRAINT transactions_amount_positive CHECK (amount_cents > 0)
);

-- Alerts table
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    suspect_txn_id UUID REFERENCES transactions(id),
    
    -- Alert details
    risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level risk_level NOT NULL,
    reasons JSONB NOT NULL DEFAULT '[]',
    status alert_status NOT NULL DEFAULT 'OPEN',
    
    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Cases table
CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    txn_id UUID REFERENCES transactions(id),
    alert_id UUID REFERENCES alerts(id),
    
    -- Case details
    type case_type NOT NULL,
    status case_status NOT NULL DEFAULT 'OPEN',
    reason_code VARCHAR(10),
    amount_cents BIGINT,
    
    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    
    -- Assignment
    assigned_to VARCHAR(255),
    priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Case events (audit trail)
CREATE TABLE case_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    
    -- Event details
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    payload_json JSONB DEFAULT '{}',
    
    -- System info
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100)
);

-- Triage runs table
CREATE TABLE triage_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id),
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    latency_ms INTEGER,
    
    -- Results
    risk_level risk_level,
    reasons JSONB DEFAULT '[]',
    recommended_action VARCHAR(100),
    fallback_used BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    agent_version VARCHAR(50),
    metadata JSONB DEFAULT '{}'
);

-- Agent traces table
CREATE TABLE agent_traces (
    run_id UUID NOT NULL REFERENCES triage_runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    
    -- Step details
    step VARCHAR(100) NOT NULL,
    agent VARCHAR(50) NOT NULL,
    tool VARCHAR(50),
    
    -- Results
    ok BOOLEAN NOT NULL,
    duration_ms INTEGER NOT NULL,
    detail_json JSONB DEFAULT '{}',
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    
    PRIMARY KEY (run_id, seq)
);

-- Knowledge base documents
CREATE TABLE kb_docs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    anchor VARCHAR(200),
    content_text TEXT NOT NULL,
    
    -- Organization
    category VARCHAR(100),
    tags TEXT[],
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    
    -- Search optimization
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content_text, '')), 'B')
    ) STORED
);

-- Policies table
CREATE TABLE policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(500) NOT NULL,
    content_text TEXT NOT NULL,
    
    -- Status
    active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 100,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER DEFAULT 1
);

-- Devices table (for fraud detection)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL UNIQUE,
    customer_id UUID REFERENCES customers(id),
    
    -- Device details
    fingerprint TEXT,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Risk scoring
    risk_score INTEGER DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    is_trusted BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Create indexes for optimal performance

-- Primary transaction query patterns
CREATE INDEX CONCURRENTLY idx_transactions_customer_ts ON transactions(customer_id, ts DESC);
CREATE INDEX CONCURRENTLY idx_transactions_merchant ON transactions(merchant);
CREATE INDEX CONCURRENTLY idx_transactions_mcc ON transactions(mcc);
CREATE INDEX CONCURRENTLY idx_transactions_customer_merchant ON transactions(customer_id, merchant);
CREATE INDEX CONCURRENTLY idx_transactions_device_id ON transactions(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_transactions_ts ON transactions(ts) WHERE ts > NOW() - INTERVAL '90 days';

-- Alert and case queries
CREATE INDEX CONCURRENTLY idx_alerts_customer_created ON alerts(customer_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_alerts_status_risk ON alerts(status, risk_level, created_at DESC);
CREATE INDEX CONCURRENTLY idx_cases_customer_status ON cases(customer_id, status);
CREATE INDEX CONCURRENTLY idx_cases_assigned ON cases(assigned_to, status) WHERE assigned_to IS NOT NULL;

-- Triage and trace queries
CREATE INDEX CONCURRENTLY idx_triage_runs_alert ON triage_runs(alert_id);
CREATE INDEX CONCURRENTLY idx_triage_runs_timing ON triage_runs(started_at DESC);
CREATE INDEX CONCURRENTLY idx_agent_traces_run_seq ON agent_traces(run_id, seq);

-- Knowledge base search
CREATE INDEX CONCURRENTLY idx_kb_docs_search ON kb_docs USING GIN(search_vector);
CREATE INDEX CONCURRENTLY idx_kb_docs_category ON kb_docs(category);

-- Customer and card lookups
CREATE INDEX CONCURRENTLY idx_cards_customer ON cards(customer_id);
CREATE INDEX CONCURRENTLY idx_accounts_customer ON accounts(customer_id);
CREATE INDEX CONCURRENTLY idx_customers_email ON customers(email_masked);

-- Case events audit
CREATE INDEX CONCURRENTLY idx_case_events_case_ts ON case_events(case_id, ts DESC);
CREATE INDEX CONCURRENTLY idx_case_events_actor ON case_events(actor, ts DESC);

-- Device tracking
CREATE INDEX CONCURRENTLY idx_devices_customer ON devices(customer_id);
CREATE INDEX CONCURRENTLY idx_devices_last_seen ON devices(last_seen DESC);

-- Create trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON cases FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_kb_docs_updated_at BEFORE UPDATE ON kb_docs FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON policies FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Create views for common queries

-- Customer summary view
CREATE VIEW v_customer_summary AS
SELECT 
    c.id,
    c.name,
    c.email_masked,
    c.kyc_level,
    COUNT(DISTINCT cards.id) as card_count,
    COUNT(DISTINCT accounts.id) as account_count,
    COALESCE(SUM(accounts.balance_cents), 0) as total_balance_cents,
    COUNT(DISTINCT txn.id) as transaction_count,
    COUNT(DISTINCT alerts.id) FILTER (WHERE alerts.status = 'OPEN') as open_alerts,
    c.created_at
FROM customers c
LEFT JOIN cards ON cards.customer_id = c.id
LEFT JOIN accounts ON accounts.customer_id = c.id
LEFT JOIN transactions txn ON txn.customer_id = c.id AND txn.ts > NOW() - INTERVAL '90 days'
LEFT JOIN alerts ON alerts.customer_id = c.id
GROUP BY c.id, c.name, c.email_masked, c.kyc_level, c.created_at;

-- Alert queue view
CREATE VIEW v_alert_queue AS
SELECT 
    a.id,
    a.customer_id,
    c.name as customer_name,
    a.risk_score,
    a.risk_level,
    a.reasons,
    a.status,
    a.created_at,
    t.merchant,
    t.amount_cents,
    t.currency,
    t.ts as transaction_ts,
    tr.id as triage_run_id,
    tr.recommended_action
FROM alerts a
JOIN customers c ON c.id = a.customer_id
LEFT JOIN transactions t ON t.id = a.suspect_txn_id
LEFT JOIN triage_runs tr ON tr.alert_id = a.id AND tr.ended_at = (
    SELECT MAX(tr2.ended_at) 
    FROM triage_runs tr2 
    WHERE tr2.alert_id = a.id
)
WHERE a.status IN ('OPEN', 'INVESTIGATING')
ORDER BY a.risk_score DESC, a.created_at ASC;

-- Performance monitoring view
CREATE VIEW v_performance_metrics AS
SELECT 
    DATE_TRUNC('hour', started_at) as hour,
    COUNT(*) as triage_runs,
    AVG(latency_ms) as avg_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency_ms,
    COUNT(*) FILTER (WHERE fallback_used = true) as fallback_count,
    COUNT(*) FILTER (WHERE risk_level = 'HIGH') as high_risk_count
FROM triage_runs
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', started_at)
ORDER BY hour DESC;