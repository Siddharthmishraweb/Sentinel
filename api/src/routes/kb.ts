import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { asyncErrorHandler } from '../middleware';

interface RouteConfig {
  database: Database;
  metrics: MetricsService;
  logger: Logger;
}

interface KnowledgeArticle {
  id?: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  author?: string;
  version?: number;
}

export const createKnowledgeBaseRouter = (config: RouteConfig): Router => {
  const router = Router();
  const { database, metrics, logger } = config;

  // Search knowledge base
  router.get('/search', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { q, category, tags, limit = 20, offset = 0 } = req.query;

    logger.info('Searching knowledge base', { requestId, query: q, category, tags });

    try {
      if (!q) {
        return res.status(400).json({
          error: 'Search query parameter "q" is required',
          timestamp: new Date().toISOString()
        });
      }

      let searchQuery = `
        SELECT id, title, content, category, tags, status, created_at, updated_at,
               ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
        FROM knowledge_articles 
        WHERE search_vector @@ plainto_tsquery('english', $1)
        AND status = 'published'
      `;
      
      const params: any[] = [q];
      let paramIndex = 2;

      if (category) {
        searchQuery += ` AND category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        searchQuery += ` AND tags && $${paramIndex}`;
        params.push(tagArray);
        paramIndex++;
      }

      searchQuery += ` ORDER BY rank DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const results = await database.query(searchQuery, params);

      metrics.incrementCounter('kb_search_total', { category: category as string || 'all' });

      res.json({
        success: true,
        results,
        query: q,
        total: results.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Knowledge base search failed', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Search failed',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get article by ID
  router.get('/articles/:id', asyncErrorHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestId = req.get('X-Request-ID');

    logger.info('Fetching knowledge article', { requestId, articleId: id });

    try {
      const article = await database.query(
        'SELECT * FROM knowledge_articles WHERE id = $1 AND status != $2',
        [id, 'archived']
      );

      if (article.length === 0) {
        metrics.incrementCounter('kb_article_not_found_total');
        return res.status(404).json({
          error: 'Article not found',
          articleId: id,
          timestamp: new Date().toISOString()
        });
      }

      // Increment view count
      await database.query(
        'UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id = $1',
        [id]
      );

      metrics.incrementCounter('kb_article_view_total', { category: article[0].category });

      res.json({
        success: true,
        article: article[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch article', { requestId, articleId: id, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to fetch article',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Create new article
  router.post('/articles', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const articleData: KnowledgeArticle = req.body;

    logger.info('Creating knowledge article', { requestId, title: articleData.title });

    try {
      // Validate required fields
      if (!articleData.title || !articleData.content || !articleData.category) {
        return res.status(400).json({
          error: 'Missing required fields: title, content, category',
          timestamp: new Date().toISOString()
        });
      }

      const result = await database.query(
        `INSERT INTO knowledge_articles (title, content, category, tags, status, author, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING *`,
        [
          articleData.title,
          articleData.content,
          articleData.category,
          articleData.tags || [],
          articleData.status || 'draft',
          articleData.author || 'system'
        ]
      );

      metrics.incrementCounter('kb_article_created_total', { category: articleData.category });

      res.status(201).json({
        success: true,
        article: result[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create article', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to create article',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Update article
  router.put('/articles/:id', asyncErrorHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestId = req.get('X-Request-ID');
    const updateData: Partial<KnowledgeArticle> = req.body;

    logger.info('Updating knowledge article', { requestId, articleId: id });

    try {
      const result = await database.query(
        `UPDATE knowledge_articles 
         SET title = COALESCE($2, title),
             content = COALESCE($3, content),
             category = COALESCE($4, category),
             tags = COALESCE($5, tags),
             status = COALESCE($6, status),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND status != 'archived'
         RETURNING *`,
        [
          id,
          updateData.title,
          updateData.content,
          updateData.category,
          updateData.tags,
          updateData.status
        ]
      );

      if (result.length === 0) {
        metrics.incrementCounter('kb_article_not_found_total');
        return res.status(404).json({
          error: 'Article not found or archived',
          articleId: id,
          timestamp: new Date().toISOString()
        });
      }

      metrics.incrementCounter('kb_article_updated_total', { category: result[0].category });

      res.json({
        success: true,
        article: result[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update article', { requestId, articleId: id, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to update article',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Delete/Archive article
  router.delete('/articles/:id', asyncErrorHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestId = req.get('X-Request-ID');
    const { permanent = false } = req.query;

    logger.info('Deleting knowledge article', { requestId, articleId: id, permanent });

    try {
      let result;
      
      if (permanent === 'true') {
        result = await database.query(
          'DELETE FROM knowledge_articles WHERE id = $1 RETURNING id, title',
          [id]
        );
      } else {
        result = await database.query(
          `UPDATE knowledge_articles 
           SET status = 'archived', updated_at = NOW() 
           WHERE id = $1 AND status != 'archived'
           RETURNING id, title`,
          [id]
        );
      }

      if (result.length === 0) {
        metrics.incrementCounter('kb_article_not_found_total');
        return res.status(404).json({
          error: 'Article not found',
          articleId: id,
          timestamp: new Date().toISOString()
        });
      }

      metrics.incrementCounter('kb_article_deleted_total', { 
        type: permanent === 'true' ? 'permanent' : 'archived' 
      });

      res.json({
        success: true,
        message: permanent === 'true' ? 'Article permanently deleted' : 'Article archived',
        articleId: id,
        title: result[0].title,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete article', { requestId, articleId: id, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to delete article',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get categories
  router.get('/categories', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');

    logger.info('Fetching knowledge base categories', { requestId });

    try {
      const categories = await database.query(
        `SELECT category, COUNT(*) as article_count 
         FROM knowledge_articles 
         WHERE status = 'published' 
         GROUP BY category 
         ORDER BY article_count DESC`
      );

      metrics.incrementCounter('kb_categories_fetched_total');

      res.json({
        success: true,
        categories,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch categories', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to fetch categories',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get popular articles
  router.get('/popular', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { limit = 10, category } = req.query;

    logger.info('Fetching popular articles', { requestId, limit, category });

    try {
      let query = `
        SELECT id, title, category, view_count, created_at, updated_at
        FROM knowledge_articles 
        WHERE status = 'published'
      `;
      
      const params: any[] = [];
      let paramIndex = 1;

      if (category) {
        query += ` AND category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      query += ` ORDER BY view_count DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit as string));

      const articles = await database.query(query, params);

      metrics.incrementCounter('kb_popular_fetched_total');

      res.json({
        success: true,
        articles,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch popular articles', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to fetch popular articles',
        timestamp: new Date().toISOString()
      });
    }
  }));

  return router;
};