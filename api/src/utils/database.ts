import { Pool, PoolClient } from 'pg';
import { createLogger } from 'winston';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: require('winston').format.combine(
    require('winston').format.timestamp(),
    require('winston').format.json()
  ),
});

export class Database {
  private pool: Pool;
  private static instance: Database;

  private constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', { error: err });
    });

    // Test connection
    this.pool.connect()
      .then((client) => {
        logger.info('Database connected successfully');
        client.release();
      })
      .catch((err) => {
        logger.error('Database connection failed', { error: err });
        process.exit(1);
      });
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { query: text.substring(0, 100), duration, rows: result.rowCount });
      return result.rows;
    } catch (error) {
      logger.error('Query failed', { query: text.substring(0, 100), error, params });
      throw error;
    }
  }

  public async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  // Health check
  public async isHealthy(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // Migration utilities
  public async runMigrations(): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Check if migrations have already been run by checking for a core table
      const result = await this.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'customers');");
      if (result && result.length > 0 && result[0].exists === true) {
        logger.info('Database already migrated, skipping migrations');
        return;
      }
    } catch (error) {
      // If query fails, continue with migrations
      logger.debug('Migration check failed, proceeding with migrations', { error });
    }
    
    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        try {
          await this.query(sql);
          logger.info('Migration executed successfully', { file });
        } catch (error) {
          logger.error('Migration failed', { file, error });
          throw error;
        }
      }
    }
  }
}

// Query builder utilities
export class QueryBuilder {
  private conditions: string[] = [];
  private params: any[] = [];
  private paramCount = 0;

  public where(condition: string, value?: any): QueryBuilder {
    if (value !== undefined) {
      this.paramCount++;
      this.conditions.push(condition.replace('?', `$${this.paramCount}`));
      this.params.push(value);
    } else {
      this.conditions.push(condition);
    }
    return this;
  }

  public whereIn(column: string, values: any[]): QueryBuilder {
    if (values.length === 0) return this;
    
    const placeholders = values.map(() => {
      this.paramCount++;
      return `$${this.paramCount}`;
    }).join(', ');
    
    this.conditions.push(`${column} IN (${placeholders})`);
    this.params.push(...values);
    return this;
  }

  public whereNotNull(column: string): QueryBuilder {
    this.conditions.push(`${column} IS NOT NULL`);
    return this;
  }

  public whereBetween(column: string, start: any, end: any): QueryBuilder {
    this.paramCount += 2;
    this.conditions.push(`${column} BETWEEN $${this.paramCount - 1} AND $${this.paramCount}`);
    this.params.push(start, end);
    return this;
  }

  public build(): { where: string; params: any[] } {
    return {
      where: this.conditions.length > 0 ? `WHERE ${this.conditions.join(' AND ')}` : '',
      params: this.params,
    };
  }
}

// Pagination utilities
export interface PaginationParams {
  cursor?: string;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
}

export interface PaginationResult<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
  total?: number;
}

export class PaginationHelper {
  public static encodeCursor(value: any): string {
    return Buffer.from(JSON.stringify(value)).toString('base64');
  }

  public static decodeCursor(cursor: string): any {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch {
      throw new Error('Invalid cursor format');
    }
  }

  public static buildKeysetQuery(
    baseQuery: string,
    params: PaginationParams,
    defaultSort = 'created_at',
    defaultDirection = 'DESC'
  ): { query: string; params: any[] } {
    const limit = Math.min(params.limit || 50, 1000);
    const sortBy = params.sortBy || defaultSort;
    const sortDirection = params.sortDirection || defaultDirection;
    
    let query = baseQuery;
    const queryParams: any[] = [];
    let paramCount = 0;

    // Add cursor condition
    if (params.cursor) {
      try {
        const cursorValue = this.decodeCursor(params.cursor);
        paramCount++;
        const operator = sortDirection === 'ASC' ? '>' : '<';
        query += ` AND ${sortBy} ${operator} $${paramCount}`;
        queryParams.push(cursorValue);
      } catch (error) {
        // Invalid cursor, ignore
      }
    }

    // Add ordering and limit
    paramCount++;
    query += ` ORDER BY ${sortBy} ${sortDirection} LIMIT $${paramCount}`;
    queryParams.push(limit + 1); // Fetch one extra to check if there are more

    return { query, params: queryParams };
  }

  public static processResults<T>(
    results: T[],
    limit: number,
    cursorField: keyof T
  ): PaginationResult<T> {
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore && items.length > 0 
      ? this.encodeCursor(items[items.length - 1][cursorField])
      : undefined;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}

// Connection pool monitoring
export function monitorConnectionPool(pool: Pool): void {
  setInterval(() => {
    logger.debug('Connection pool stats', {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    });
  }, 30000);
}

export default Database;