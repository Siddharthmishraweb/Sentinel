import { createClient, RedisClientType } from 'redis';
import { createLogger } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: require('winston').format.combine(
    require('winston').format.timestamp(),
    require('winston').format.json()
  ),
});

export class RedisClient {
  private client: RedisClientType;
  private static instance: RedisClient;
  private connected = false;

  private constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    });

    this.client.on('error', (err) => {
      logger.error('Redis Client Error', { error: err });
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Redis client disconnected');
      this.connected = false;
    });
  }

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  public async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
    }
  }

  public async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  // Rate limiting with token bucket
  public async checkRateLimit(
    key: string, 
    limit: number, 
    windowMs: number,
    burstLimit?: number
  ): Promise<{ allowed: boolean; retryAfter?: number; remaining?: number }> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const redisKey = `ratelimit:${key}:${windowStart}`;

    try {
      const count = await this.client.incr(redisKey);
      
      if (count === 1) {
        await this.client.expire(redisKey, Math.ceil(windowMs / 1000));
      }

      const remaining = Math.max(0, limit - count);
      const allowed = count <= limit;

      if (!allowed) {
        const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
        return { allowed: false, retryAfter, remaining: 0 };
      }

      return { allowed: true, remaining };
    } catch (error) {
      logger.error('Rate limit check failed', { error, key });
      // Fail open for availability
      return { allowed: true };
    }
  }

  // Token bucket rate limiting for burst handling
  public async checkTokenBucket(
    key: string,
    capacity: number,
    refillRate: number,
    tokensRequested: number = 1
  ): Promise<{ allowed: boolean; tokens: number; retryAfter?: number }> {
    const now = Date.now();
    const bucketKey = `bucket:${key}`;

    try {
      const result = await this.client.eval(
        `
        local bucket = KEYS[1]
        local capacity = tonumber(ARGV[1])
        local refill_rate = tonumber(ARGV[2])
        local tokens_requested = tonumber(ARGV[3])
        local now = tonumber(ARGV[4])

        local bucket_data = redis.call('HMGET', bucket, 'tokens', 'last_refill')
        local tokens = tonumber(bucket_data[1]) or capacity
        local last_refill = tonumber(bucket_data[2]) or now

        -- Calculate tokens to add based on time elapsed
        local time_passed = (now - last_refill) / 1000
        local tokens_to_add = math.floor(time_passed * refill_rate)
        tokens = math.min(capacity, tokens + tokens_to_add)

        local allowed = tokens >= tokens_requested
        if allowed then
          tokens = tokens - tokens_requested
        end

        -- Update bucket
        redis.call('HMSET', bucket, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', bucket, 3600) -- Expire after 1 hour of inactivity

        return {allowed and 1 or 0, tokens}
        `, 
        { 
          keys: [bucketKey], 
          arguments: [capacity.toString(), refillRate.toString(), tokensRequested.toString(), now.toString()] 
        }
      ) as [number, number];

      const [allowedNum, tokens] = result;
      const allowed = allowedNum === 1;

      if (!allowed) {
        const retryAfter = Math.ceil((tokensRequested - tokens) / refillRate);
        return { allowed: false, tokens, retryAfter };
      }

      return { allowed: true, tokens };
    } catch (error) {
      logger.error('Token bucket check failed', { error, key });
      return { allowed: true, tokens: capacity };
    }
  }

  // Idempotency key handling
  public async setIdempotencyResult(
    key: string, 
    result: any, 
    ttlSeconds: number = 3600
  ): Promise<void> {
    try {
      await this.client.setEx(
        `idempotency:${key}`, 
        ttlSeconds, 
        JSON.stringify(result)
      );
    } catch (error) {
      logger.error('Failed to set idempotency result', { error, key });
    }
  }

  public async getIdempotencyResult(key: string): Promise<any | null> {
    try {
      const result = await this.client.get(`idempotency:${key}`);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error('Failed to get idempotency result', { error, key });
      return null;
    }
  }

  // Caching utilities
  public async get<T>(key: string): Promise<T | null> {
    try {
      const result = await this.client.get(key);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error('Failed to get cache value', { error, key });
      return null;
    }
  }

  public async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      logger.error('Failed to set cache value', { error, key });
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error('Failed to delete cache key', { error, key });
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Failed to check key existence', { error, key });
      return false;
    }
  }

  // Session management
  public async createSession(sessionId: string, data: any, ttlSeconds: number = 3600): Promise<void> {
    await this.set(`session:${sessionId}`, data, ttlSeconds);
  }

  public async getSession<T>(sessionId: string): Promise<T | null> {
    return this.get<T>(`session:${sessionId}`);
  }

  public async deleteSession(sessionId: string): Promise<void> {
    await this.del(`session:${sessionId}`);
  }

  // Circuit breaker state management
  public async getCircuitBreakerState(name: string): Promise<{
    failures: number;
    lastFailure: number | null;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  }> {
    try {
      const state = await this.client.hGetAll(`circuit:${name}`);
      return {
        failures: parseInt(state.failures || '0'),
        lastFailure: state.lastFailure ? parseInt(state.lastFailure) : null,
        state: (state.state as any) || 'CLOSED'
      };
    } catch (error) {
      logger.error('Failed to get circuit breaker state', { error, name });
      return { failures: 0, lastFailure: null, state: 'CLOSED' };
    }
  }

  public async updateCircuitBreakerState(
    name: string, 
    failures: number, 
    lastFailure: number | null, 
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  ): Promise<void> {
    try {
      const updates: Record<string, string> = {
        failures: failures.toString(),
        state
      };
      
      if (lastFailure !== null) {
        updates.lastFailure = lastFailure.toString();
      }

      await this.client.hSet(`circuit:${name}`, updates);
      await this.client.expire(`circuit:${name}`, 3600);
    } catch (error) {
      logger.error('Failed to update circuit breaker state', { error, name });
    }
  }

  // Background job queue (simple implementation)
  public async enqueueJob(queue: string, job: any): Promise<void> {
    try {
      await this.client.lPush(`queue:${queue}`, JSON.stringify({
        ...job,
        enqueuedAt: Date.now()
      }));
    } catch (error) {
      logger.error('Failed to enqueue job', { error, queue, job });
    }
  }

  public async dequeueJob(queue: string): Promise<any | null> {
    try {
      const result = await this.client.brPop(`queue:${queue}`, 1);
      return result ? JSON.parse(result.element) : null;
    } catch (error) {
      logger.error('Failed to dequeue job', { error, queue });
      return null;
    }
  }

  // List operations for event streaming
  public async lpush(key: string, value: string): Promise<void> {
    try {
      await this.client.lPush(key, value);
    } catch (error) {
      logger.error('Failed to push to list', { error, key });
    }
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      logger.error('Failed to get list range', { error, key });
      return [];
    }
  }

  public async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      logger.error('Failed to set expiry', { error, key });
    }
  }

  // Clear all data in the current database (use with caution!)
  public async flushDb(): Promise<void> {
    try {
      await this.client.flushDb();
    } catch (error) {
      logger.error('Failed to flush database', { error });
    }
  }

  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}

export default RedisClient;