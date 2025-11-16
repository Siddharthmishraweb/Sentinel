import 'jest-extended/all';
import { Database } from '../src/utils/database';
import { RedisClient } from '../src/utils/redis';

// Test database configuration
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/sentinel_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
process.env.LOG_LEVEL = 'warn';
process.env.API_KEY = 'test-api-key';

// Global test instances
declare global {
  var testDatabase: Database;
  var testRedis: RedisClient;
}

beforeAll(async () => {
  // Initialize test database
  global.testDatabase = Database.getInstance();
  
  // Initialize test Redis
  global.testRedis = RedisClient.getInstance();
  await global.testRedis.connect();
  
  // Clear test database
  await setupTestDatabase();
});

afterAll(async () => {
  // Clean up test data
  await teardownTestDatabase();
  
  // Close connections
  await global.testRedis.disconnect();
  await global.testDatabase.close();
});

beforeEach(async () => {
  // Clear Redis cache before each test
  await global.testRedis.flushDb();
});

async function setupTestDatabase(): Promise<void> {
  try {
    // Create test tables if they don't exist
    await global.testDatabase.query(`
      CREATE TABLE IF NOT EXISTS customer_data (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(255) UNIQUE NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await global.testDatabase.query(`
      CREATE TABLE IF NOT EXISTS interactions (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        channel VARCHAR(100),
        content TEXT,
        sentiment_score DECIMAL(3,2),
        category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        resolution_time_minutes INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await global.testDatabase.query(`
      CREATE TABLE IF NOT EXISTS knowledge_articles (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        tags TEXT[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'draft',
        author VARCHAR(255) DEFAULT 'system',
        version INTEGER DEFAULT 1,
        view_count INTEGER DEFAULT 0,
        search_vector tsvector,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for better performance
    await global.testDatabase.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_data_customer_id ON customer_data(customer_id)
    `);

    await global.testDatabase.query(`
      CREATE INDEX IF NOT EXISTS idx_interactions_customer_id ON interactions(customer_id)
    `);

    await global.testDatabase.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_articles_status ON knowledge_articles(status)
    `);

    // Update search vectors
    await global.testDatabase.query(`
      UPDATE knowledge_articles 
      SET search_vector = to_tsvector('english', title || ' ' || content)
      WHERE search_vector IS NULL
    `);

  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}

async function teardownTestDatabase(): Promise<void> {
  try {
    // Clean up test data
    await global.testDatabase.query('TRUNCATE customer_data, interactions, knowledge_articles RESTART IDENTITY CASCADE');
  } catch (error) {
    console.error('Failed to teardown test database:', error);
  }
}

// Test utilities
export const TestUtils = {
  createTestCustomer: async (customerId: string = 'test-customer-001', data: any = {}) => {
    const customerData = {
      customerId,
      email: 'test@example.com',
      name: 'Test Customer',
      tier: 'premium',
      ...data
    };

    await global.testDatabase.query(
      'INSERT INTO customer_data (customer_id, data) VALUES ($1, $2) ON CONFLICT (customer_id) DO UPDATE SET data = EXCLUDED.data',
      [customerId, customerData]
    );

    return customerData;
  },

  createTestInteraction: async (customerId: string = 'test-customer-001', data: any = {}) => {
    const interactionData = {
      customer_id: customerId,
      channel: 'email',
      content: 'Test interaction content',
      sentiment_score: 0.7,
      category: 'billing',
      status: 'resolved',
      resolution_time_minutes: 30,
      ...data
    };

    const result = await global.testDatabase.query(
      `INSERT INTO interactions (customer_id, channel, content, sentiment_score, category, status, resolution_time_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        interactionData.customer_id,
        interactionData.channel,
        interactionData.content,
        interactionData.sentiment_score,
        interactionData.category,
        interactionData.status,
        interactionData.resolution_time_minutes
      ]
    );

    return result[0];
  },

  createTestArticle: async (data: any = {}) => {
    const articleData = {
      title: 'Test Article',
      content: 'Test article content for knowledge base',
      category: 'support',
      tags: ['test', 'example'],
      status: 'published',
      author: 'test-author',
      ...data
    };

    const result = await global.testDatabase.query(
      `INSERT INTO knowledge_articles (title, content, category, tags, status, author)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        articleData.title,
        articleData.content,
        articleData.category,
        articleData.tags,
        articleData.status,
        articleData.author
      ]
    );

    // Update search vector
    await global.testDatabase.query(
      `UPDATE knowledge_articles 
       SET search_vector = to_tsvector('english', title || ' ' || content)
       WHERE id = $1`,
      [result[0].id]
    );

    return result[0];
  },

  clearTestData: async () => {
    await global.testDatabase.query('TRUNCATE customer_data, interactions, knowledge_articles RESTART IDENTITY CASCADE');
    await global.testRedis.flushDb();
  },

  waitForMs: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};