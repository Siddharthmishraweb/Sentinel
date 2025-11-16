import { Logger } from 'winston';
import { Database } from '../utils/database';

export interface KBSearchResult {
  doc_id: string;
  title: string;
  anchor: string;
  extract: string;
  relevance_score: number;
  metadata?: any;
}

export interface KBResponse {
  results: KBSearchResult[];
  query: string;
  total_results: number;
  search_time_ms: number;
}

export class KBAgent {
  private database: Database;
  private logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  async search(query: string, limit: number = 5): Promise<KBResponse> {
    const startTime = Date.now();
    
    try {
      this.logger.info('KB search initiated', { query, limit });

      // Simple text search in knowledge base documents
      // In production, this would use full-text search with ranking
      const searchQuery = `
        SELECT 
          id as doc_id,
          title,
          anchor,
          SUBSTRING(content_text, 1, 200) as extract,
          content_text
        FROM kb_docs
        WHERE 
          LOWER(title) LIKE LOWER($1) OR 
          LOWER(content_text) LIKE LOWER($1) OR
          LOWER(anchor) LIKE LOWER($1)
        ORDER BY 
          CASE 
            WHEN LOWER(title) LIKE LOWER($1) THEN 1
            WHEN LOWER(anchor) LIKE LOWER($1) THEN 2 
            ELSE 3
          END,
          LENGTH(content_text) ASC
        LIMIT $2
      `;

      const searchTerm = `%${query}%`;
      const results = await this.database.query(searchQuery, [searchTerm, limit]) as any[];

      // Calculate relevance scores and format results
      const formattedResults: KBSearchResult[] = results.map((doc, index) => {
        const relevanceScore = this.calculateRelevanceScore(query, doc, index);
        
        return {
          doc_id: doc.doc_id,
          title: doc.title,
          anchor: doc.anchor,
          extract: this.extractRelevantText(doc.content_text, query),
          relevance_score: relevanceScore,
          metadata: {
            content_length: doc.content_text?.length || 0,
            search_rank: index + 1
          }
        };
      });

      // Sort by relevance score
      formattedResults.sort((a, b) => b.relevance_score - a.relevance_score);

      const searchTime = Date.now() - startTime;
      
      this.logger.info('KB search completed', {
        query,
        resultsFound: formattedResults.length,
        searchTime
      });

      return {
        results: formattedResults,
        query,
        total_results: formattedResults.length,
        search_time_ms: searchTime
      };

    } catch (error: any) {
      const searchTime = Date.now() - startTime;
      this.logger.error('KB search failed', {
        query,
        searchTime,
        error: error.message
      });
      
      // Return empty results on error rather than throwing
      return {
        results: [],
        query,
        total_results: 0,
        search_time_ms: searchTime
      };
    }
  }

  async getCitedAnswer(questionType: string, context?: any): Promise<KBSearchResult | null> {
    try {
      this.logger.info('Getting cited answer', { questionType, context });

      // Map common question types to search queries
      const queryMap: { [key: string]: string } = {
        'dispute': 'dispute chargeback process',
        'freeze_card': 'freeze card procedure',
        'fraud': 'fraud detection policy',
        'kyc': 'know your customer verification',
        'risk': 'risk assessment guidelines',
        'compliance': 'compliance requirements',
        'otp': 'one time password authentication',
        'authorization': 'card authorization policy',
        'preauth': 'preauthorization vs capture',
        'duplicate': 'duplicate transaction handling'
      };

      const searchQuery = queryMap[questionType.toLowerCase()] || questionType;
      const response = await this.search(searchQuery, 1);

      return response.results.length > 0 ? response.results[0] : null;

    } catch (error: any) {
      this.logger.error('Failed to get cited answer', {
        questionType,
        error: error.message
      });
      return null;
    }
  }

  async getMultipleCitations(topics: string[]): Promise<{ [topic: string]: KBSearchResult | null }> {
    const results: { [topic: string]: KBSearchResult | null } = {};

    for (const topic of topics) {
      try {
        const citation = await this.getCitedAnswer(topic);
        results[topic] = citation;
      } catch (error) {
        this.logger.warn('Failed to get citation for topic', { topic, error });
        results[topic] = null;
      }
    }

    return results;
  }

  private calculateRelevanceScore(query: string, doc: any, rank: number): number {
    let score = 0;
    const queryLower = query.toLowerCase();
    const titleLower = doc.title.toLowerCase();
    const anchorLower = doc.anchor.toLowerCase();
    const contentLower = doc.content_text?.toLowerCase() || '';

    // Title match bonus
    if (titleLower.includes(queryLower)) {
      score += 10;
    }

    // Anchor match bonus  
    if (anchorLower.includes(queryLower)) {
      score += 8;
    }

    // Content match scoring
    const queryWords = queryLower.split(' ').filter(word => word.length > 2);
    queryWords.forEach(word => {
      const titleMatches = (titleLower.match(new RegExp(word, 'g')) || []).length;
      const contentMatches = (contentLower.match(new RegExp(word, 'g')) || []).length;
      
      score += titleMatches * 3;
      score += contentMatches * 0.5;
    });

    // Penalize for rank (earlier results get higher scores)
    score -= rank * 0.5;

    // Document length normalization (prefer concise, focused docs)
    const contentLength = doc.content_text?.length || 0;
    if (contentLength > 1000) {
      score -= (contentLength - 1000) * 0.001;
    }

    return Math.max(score, 0);
  }

  private extractRelevantText(content: string, query: string): string {
    if (!content) return '';

    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    
    // Find the first occurrence of query terms
    const queryIndex = contentLower.indexOf(queryLower);
    
    if (queryIndex !== -1) {
      // Extract context around the match
      const start = Math.max(0, queryIndex - 100);
      const end = Math.min(content.length, queryIndex + 200);
      let extract = content.substring(start, end);
      
      if (start > 0) extract = '...' + extract;
      if (end < content.length) extract += '...';
      
      return extract;
    }

    // If no direct match, return first 200 characters
    return content.substring(0, 200) + (content.length > 200 ? '...' : '');
  }

  async getDocumentById(docId: string): Promise<any> {
    try {
      const query = 'SELECT * FROM kb_docs WHERE id = $1';
      const results = await this.database.query(query, [docId]) as any[];
      
      return results.length > 0 ? results[0] : null;
    } catch (error: any) {
      this.logger.error('Failed to get document by ID', { docId, error: error.message });
      return null;
    }
  }

  async getAllDocuments(): Promise<any[]> {
    try {
      const query = 'SELECT id, title, anchor FROM kb_docs ORDER BY title';
      const results = await this.database.query(query, []) as any[];
      
      return results;
    } catch (error: any) {
      this.logger.error('Failed to get all documents', { error: error.message });
      return [];
    }
  }
}