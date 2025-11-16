# Architecture Decision Records (ADR)

## ADR-001: Monorepo Structure with Workspaces
**Decision**: Use npm workspaces for managing frontend and backend packages in a single repository.

**Rationale**: 
- Shared TypeScript types between frontend and backend
- Simplified deployment with single Docker Compose setup
- Easier dependency management and version consistency
- Faster iteration for full-stack features

**Alternatives Considered**: 
- Separate repositories (rejected: increases complexity)
- Lerna (rejected: npm workspaces sufficient for our needs)

---

## ADR-002: PostgreSQL with Optimized Indexing Strategy
**Decision**: Use PostgreSQL as primary database with compound indexes on (customer_id, ts DESC).

**Rationale**:
- ACID compliance required for financial data
- Excellent performance with proper indexing for time-series queries
- Mature ecosystem with extensive monitoring tools
- Native JSON support for metadata fields

**Key Indexes**:
- `idx_transactions_customer_ts` for customer transaction history
- `idx_transactions_merchant` for merchant-based queries
- `idx_alerts_status_risk` for alert queue optimization

**Alternatives Considered**:
- MongoDB (rejected: eventual consistency unacceptable)
- ClickHouse (rejected: overkill for current scale)

---

## ADR-003: Keyset Pagination Over Offset/Limit
**Decision**: Implement cursor-based (keyset) pagination for all paginated endpoints.

**Rationale**:
- Consistent performance regardless of page depth
- Avoids duplicate results when data is inserted during pagination
- Critical for real-time alert queue where new items appear frequently
- Scales to millions of records without degradation

**Implementation**:
- Base64-encoded cursor contains last seen timestamp/ID
- Use `WHERE timestamp > cursor_value ORDER BY timestamp DESC LIMIT n+1`
- Return `hasMore` flag and `nextCursor` for client navigation

**Alternatives Considered**:
- Offset/limit (rejected: O(n) performance degradation)
- GraphQL Relay (rejected: adds complexity for minimal benefit)

---

## ADR-004: Server-Sent Events for Real-time Updates
**Decision**: Use SSE for streaming triage updates instead of WebSockets.

**Rationale**:
- Unidirectional data flow matches our use case (server → client)
- Works through HTTP proxies and load balancers without configuration
- Built-in reconnection logic in browsers
- Simpler security model (standard HTTP authentication)

**Implementation**:
- EventSource API on frontend
- Express SSE endpoint with proper headers
- Graceful degradation to polling if SSE unavailable

**Alternatives Considered**:
- WebSockets (rejected: bidirectional complexity unnecessary)
- Polling (rejected: inefficient, not real-time)

---

## ADR-005: Token Bucket Rate Limiting with Redis
**Decision**: Implement token bucket algorithm using Redis for distributed rate limiting.

**Rationale**:
- Allows burst traffic up to configured limit (UX improvement)
- Distributed across multiple API instances
- Redis Lua scripts ensure atomic operations
- Fails open for availability (continues if Redis down)

**Configuration**:
- 5 requests/second sustained rate
- Burst capacity of 10 tokens
- Per-client IP tracking
- Exponential backoff suggestions in Retry-After header

**Alternatives Considered**:
- Fixed window (rejected: allows traffic spikes at window boundaries)
- Sliding window log (rejected: memory intensive)
- In-memory (rejected: doesn't work with multiple instances)

---

## ADR-006: Multi-Agent Architecture with Circuit Breakers
**Decision**: Implement orchestrated agents with individual timeouts and circuit breakers.

**Rationale**:
- Isolation of concerns (fraud detection, risk assessment, KB search)
- Graceful degradation when individual tools fail
- Deterministic fallbacks ensure system availability
- Comprehensive observability of each step

**Agent Design**:
- 1-second timeout per tool
- Maximum 2 retries with exponential backoff
- Circuit breaker opens after 3 consecutive failures
- Fallback responses maintain system functionality

**Alternatives Considered**:
- Single monolithic agent (rejected: failure isolation important)
- No fallbacks (rejected: availability requirement)

---

## ADR-007: PII Redaction Strategy
**Decision**: Implement automatic PII redaction using regex patterns and structured logging flags.

**Rationale**:
- Regulatory compliance requirement
- Defense in depth (redact at source, log, and display layers)
- Auditable with masked=true flags in structured logs
- Regex patterns catch common PII formats

**Implementation**:
- Card numbers (13-19 digits) → `****REDACTED****`
- Email addresses → `****REDACTED****`
- SSNs and account numbers → `****REDACTED****`
- Structured log field indicates redaction occurred

**Alternatives Considered**:
- Encryption (rejected: redaction simpler for read-only data)
- No logging of sensitive data (rejected: debugging complexity)

---

## ADR-008: Express.js over Fastify
**Decision**: Use Express.js framework despite Fastify's performance advantages.

**Rationale**:
- Larger ecosystem and community support
- More extensive middleware library
- Team familiarity and faster development
- Performance difference negligible at our scale
- Better TypeScript integration with @types/express

**Middleware Stack**:
- Helmet for security headers
- CORS with specific origin restrictions
- Compression with appropriate content types
- Winston for structured logging

**Alternatives Considered**:
- Fastify (rejected: learning curve vs. performance gain tradeoff)
- Koa.js (rejected: smaller ecosystem)

---

## ADR-009: React with Vite Build System
**Decision**: Use Vite as build tool with React 18 and TypeScript.

**Rationale**:
- Extremely fast development hot reload
- Native ES modules support
- Excellent TypeScript integration
- Smaller bundle sizes with tree shaking
- Future-proof with modern JavaScript features

**Frontend Architecture**:
- React Query for server state management
- Headless UI for accessible components
- Tailwind CSS for utility-first styling
- React Hook Form with Zod validation

**Alternatives Considered**:
- Create React App (rejected: slower builds, webpack complexity)
- Next.js (rejected: SSR not required for internal tool)

---

## ADR-010: Redis for Caching and Session State
**Decision**: Use Redis for rate limiting, sessions, circuit breaker state, and caching.

**Rationale**:
- High performance in-memory storage
- Native support for atomic operations via Lua scripts
- Built-in expiration for automatic cleanup
- Clustering support for horizontal scaling
- Excellent Node.js client ecosystem

**Use Cases**:
- Rate limiting token buckets
- Idempotency key tracking
- Session storage with TTL
- Circuit breaker failure counts
- API response caching

**Alternatives Considered**:
- In-memory (rejected: doesn't scale across instances)
- Database (rejected: too slow for rate limiting)

---

## ADR-011: Prometheus Metrics and Grafana Monitoring
**Decision**: Implement Prometheus metrics collection with optional Grafana dashboards.

**Rationale**:
- Industry standard for modern observability
- Rich query language (PromQL) for analysis
- Native histogram support for latency percentiles
- Integration with alerting systems
- Pull-based model reduces operational complexity

**Key Metrics**:
- `api_request_latency_ms` (histogram)
- `agent_latency_ms` (histogram) 
- `tool_call_total` (counter)
- `rate_limit_block_total` (counter)
- Default system metrics (memory, CPU, GC)

**Alternatives Considered**:
- StatsD (rejected: push model adds complexity)
- Custom metrics endpoint (rejected: reinventing the wheel)

---

## ADR-012: Docker Compose for Development and Production
**Decision**: Use Docker Compose for both development and production deployment.

**Rationale**:
- Consistent environment across development, testing, production
- Simplified dependency management (PostgreSQL, Redis)
- Easy horizontal scaling with `docker-compose scale`
- Health checks and automatic restarts
- Network isolation and security

**Services**:
- postgres: Primary database
- redis: Cache and session store
- api: Node.js backend
- web: Nginx serving React build
- prometheus/grafana: Optional monitoring

**Alternatives Considered**:
- Kubernetes (rejected: overkill for initial deployment)
- Manual deployment (rejected: inconsistent environments)