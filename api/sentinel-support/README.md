 # Sentinel Support Console

 Production-minded fintech fraud support console with AI triage, multi-agent orchestration, actions, evaluations, and performance instrumentation.

 ## Features
 - Multi-agent triage pipeline (profile, transactions, risk signals, KB lookup, decision, propose action)
 - SSE streaming with heartbeat and reconnection
 - Actions: freeze card (OTP), open dispute, contact customer, mark false positive
 - Audit logging persisted to `case_events`
 - RBAC: agent vs lead (lead can bypass OTP & force approvals)
 - Rate limiting: 5 req/sec with headers (X-Rate-Limit-Limit, Remaining, Reset)
 - Keyset pagination for customer transactions
 - Customer insights summary endpoint
 - Prometheus metrics (latency, tool calls, agent latency, fallbacks, rate limit blocks)
 - Data redaction for logs & UI
 - Fixtures generator for high-volume synthetic transactions
 - Evaluation CLI producing success & latency metrics

 ## Getting Started
 ```bash
 # Install dependencies
 npm install --workspaces

 # Run database & redis
 docker compose up -d

 # Migrate
 (cd sentinel-support/api && npm run migrate)

 # Start API & Web
 npm run dev --workspaces
 ```

 ## Seeding & Fixtures
 To generate additional synthetic transactions:
 ```bash
 cd sentinel-support/api
 ts-node src/scripts/generate-fixtures.ts --count 200000 --customers 500 --out fixtures/transactions-generated.json
 ```
 Import generated JSON via a custom ingest script or psql `\copy`.

 ## Evaluations
 Run evaluation CLI:
 ```bash
 cd sentinel-support/api
 ts-node src/cli/evals.ts --dir fixtures/evals
 ```
 Outputs success rate, fallback rate, latency p50/p95, confusion matrix.

 ## Performance
 Use PostgreSQL EXPLAIN ANALYZE on key queries (examples):
 ```sql
 EXPLAIN ANALYZE SELECT * FROM transactions WHERE customer_id = $1 ORDER BY ts DESC LIMIT 51;
 EXPLAIN ANALYZE SELECT alert_id, recommended_action, latency_ms FROM triage_runs ORDER BY started_at DESC LIMIT 100;
 ```
 Target p95 latency for triage < 1500ms with warm cache; transaction pagination < 100ms.

 ## Metrics Endpoint
 Expose Prometheus metrics at `/api/metrics` (if configured). Key metrics:
 - api_request_latency_ms (histogram)
 - api_request_total
 - agent_latency_ms
 - tool_call_total
 - agent_fallback_total
 - rate_limit_block_total
 - action_blocked_total

 ## Accessibility
 - Focus trap in triage drawer
 - Live regions for status updates & progress
 - Keyboard escape to close drawer

 ## RBAC
 Specify headers:
 - `X-API-Key: <key>`
 - `X-User-Role: lead|agent`
 - `X-User-Id: <user-id>`

 Lead users gain `force_approve` and `bypass_otp` permissions.

 ## Testing (Planned)
 Add tests for:
 - Audit persistence (case_events row created)
 - RBAC (lead bypass OTP, agent requires OTP)
 - Rate limiting (429 after >5 r/s)
 - SSE stream emits connected, decision_finalized, stream_complete
 - Evaluation CLI computes metrics for fixtures

 ## Roadmap
 - More eval fixtures (>12)
 - End-to-end test harness
 - Circuit breaker metrics dashboard
 - Policy-based OTP dynamic logic
 - Websocket optional transport

 ## Troubleshooting
 - Ensure `DATABASE_URL` and `REDIS_URL` set.
 - If SSE disconnects, verify reverse proxy allows long-lived connections.
 - For performance issues, check missing indexes via `pg_stat_user_indexes`.

 ---
 © 2025 Sentinel Support