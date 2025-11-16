import { Router, Request, Response } from 'express';
import { Database } from '../utils/database';
import { MetricsService } from '../services/metrics';
import { Logger } from 'winston';
import { asyncErrorHandler } from '../middleware';
import { InsightsAgent } from '../agents/insights';

interface RouteConfig {
  database: Database;
  metrics: MetricsService;
  logger: Logger;
}

interface InsightQuery {
  customerId?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  type?: string;
  limit?: number;
}

export const createInsightsRouter = (config: RouteConfig): Router => {
  const router = Router();
  const { database, metrics, logger } = config;

  // Spec-compliant summary endpoint: GET /api/insights/:customerId/summary
  // Returns categories, merchants, anomalies, monthlyTrend, totals
  router.get('/:customerId/summary', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { customerId } = req.params;
    const { lastDays = '90' } = req.query;

    logger.info('Fetching insights summary', { requestId, customerId, lastDays });

    if (!customerId) {
      return res.status(400).json({
        error: 'Customer ID is required',
        timestamp: new Date().toISOString()
      });
    }

    try {
      const days = Math.min(Math.max(parseInt(lastDays as string, 10) || 90, 1), 365);
      const agent = new InsightsAgent(database, logger);
      const insights = await agent.generateInsights(customerId, days);

      metrics.incrementCounter('insights_customer_generated_total');

      return res.json({
        success: true,
        customerId,
        summary: insights,
        generated_at: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error('Insights summary failed', { requestId, customerId, error: error.message });
      return res.status(500).json({
        error: 'Failed to generate insights summary',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get customer insights
  router.post('/customer', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const query: InsightQuery = req.body;

    logger.info('Generating customer insights', { requestId, query });

    try {
      if (!query.customerId) {
        return res.status(400).json({
          error: 'Customer ID is required',
          timestamp: new Date().toISOString()
        });
      }

      // Get customer data and interactions
      const [customerData, interactionData] = await Promise.all([
        database.query(
          'SELECT * FROM customer_data WHERE customer_id = $1',
          [query.customerId]
        ),
        database.query(
          `SELECT * FROM interactions 
           WHERE customer_id = $1 
           ORDER BY created_at DESC 
           LIMIT $2`,
          [query.customerId, query.limit || 50]
        )
      ]);

      if (customerData.length === 0) {
        metrics.incrementCounter('insights_customer_not_found_total');
        return res.status(404).json({
          error: 'Customer not found',
          customerId: query.customerId,
          timestamp: new Date().toISOString()
        });
      }

      // Generate insights based on interaction patterns
      const insights = {
        customer: customerData[0],
        interactionSummary: {
          totalInteractions: interactionData.length,
          recentInteractions: interactionData.slice(0, 10),
          channelBreakdown: getChannelBreakdown(interactionData),
          sentimentTrend: getSentimentTrend(interactionData),
          issueCategories: getIssueCategories(interactionData)
        },
        recommendations: generateRecommendations(customerData[0], interactionData),
        riskFactors: assessRiskFactors(customerData[0], interactionData)
      };

      metrics.incrementCounter('insights_customer_generated_total');

      res.json({
        success: true,
        insights,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to generate customer insights', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to generate customer insights',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get trend analysis
  router.post('/trends', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { timeRange, metrics: metricTypes } = req.body;

    logger.info('Generating trend analysis', { requestId, timeRange, metricTypes });

    try {
      const startDate = timeRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = timeRange?.end || new Date().toISOString();

      const trends = await Promise.all([
        getTrendData('interactions', startDate, endDate, database),
        getTrendData('sentiment', startDate, endDate, database),
        getTrendData('resolution_time', startDate, endDate, database)
      ]);

      const analysis = {
        interactionTrends: trends[0],
        sentimentTrends: trends[1],
        resolutionTrends: trends[2],
        summary: {
          periodStart: startDate,
          periodEnd: endDate,
          totalInteractions: trends[0].reduce((sum: number, d: any) => sum + d.value, 0),
          averageSentiment: calculateAverageSentiment(trends[1]),
          averageResolutionTime: calculateAverageResolutionTime(trends[2])
        }
      };

      metrics.incrementCounter('insights_trends_generated_total');

      res.json({
        success: true,
        trends: analysis,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to generate trend analysis', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to generate trend analysis',
        timestamp: new Date().toISOString()
      });
    }
  }));

  // Get predictive insights
  router.post('/predict', asyncErrorHandler(async (req: Request, res: Response) => {
    const requestId = req.get('X-Request-ID');
    const { customerId, predictionType } = req.body;

    logger.info('Generating predictive insights', { requestId, customerId, predictionType });

    try {
      if (!customerId) {
        return res.status(400).json({
          error: 'Customer ID is required',
          timestamp: new Date().toISOString()
        });
      }

      // Get customer historical data
      const customerHistory = await database.query(
        `SELECT * FROM interactions 
         WHERE customer_id = $1 
         ORDER BY created_at ASC`,
        [customerId]
      );

      if (customerHistory.length === 0) {
        return res.status(404).json({
          error: 'No interaction history found for customer',
          customerId,
          timestamp: new Date().toISOString()
        });
      }

      const predictions = {
        churnRisk: calculateChurnRisk(customerHistory),
        nextContactProbability: calculateNextContactProbability(customerHistory),
        satisfactionPrediction: predictSatisfaction(customerHistory),
        issueEscalationRisk: assessEscalationRisk(customerHistory),
        confidence: calculatePredictionConfidence(customerHistory.length)
      };

      metrics.incrementCounter('insights_predictions_generated_total');

      res.json({
        success: true,
        predictions,
        customerId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to generate predictions', { requestId, error: errorMessage });
      
      res.status(500).json({
        error: 'Failed to generate predictive insights',
        timestamp: new Date().toISOString()
      });
    }
  }));

  return router;
};

// Helper functions for insights generation
function getChannelBreakdown(interactions: any[]): Record<string, number> {
  return interactions.reduce((acc, interaction) => {
    const channel = interaction.channel || 'unknown';
    acc[channel] = (acc[channel] || 0) + 1;
    return acc;
  }, {});
}

function getSentimentTrend(interactions: any[]): Array<{ date: string; sentiment: number }> {
  return interactions
    .filter(i => i.sentiment_score !== null)
    .slice(0, 20)
    .map(i => ({
      date: i.created_at,
      sentiment: parseFloat(i.sentiment_score || 0)
    }));
}

function getIssueCategories(interactions: any[]): Record<string, number> {
  return interactions.reduce((acc, interaction) => {
    const category = interaction.category || 'uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
}

function generateRecommendations(customer: any, interactions: any[]): string[] {
  const recommendations = [];

  if (interactions.length > 10) {
    recommendations.push('Consider proactive outreach due to high interaction volume');
  }

  const avgSentiment = interactions
    .filter(i => i.sentiment_score !== null)
    .reduce((sum, i) => sum + parseFloat(i.sentiment_score || 0), 0) / interactions.length;

  if (avgSentiment < 0.3) {
    recommendations.push('Priority customer service attention needed due to negative sentiment');
  }

  if (interactions.length === 0) {
    recommendations.push('Consider engagement campaign for inactive customer');
  }

  return recommendations;
}

function assessRiskFactors(customer: any, interactions: any[]): Array<{ factor: string; level: 'low' | 'medium' | 'high'; description: string }> {
  const risks = [];

  // Interaction volume risk
  if (interactions.length > 15) {
    risks.push({
      factor: 'high_interaction_volume',
      level: 'high' as const,
      description: 'Customer has unusually high interaction volume'
    });
  }

  // Sentiment risk
  const recentSentiment = interactions
    .slice(0, 5)
    .filter(i => i.sentiment_score !== null)
    .map(i => parseFloat(i.sentiment_score || 0));

  const avgRecentSentiment = recentSentiment.length > 0 
    ? recentSentiment.reduce((sum, s) => sum + s, 0) / recentSentiment.length 
    : 0.5;

  if (avgRecentSentiment < 0.3) {
    risks.push({
      factor: 'negative_sentiment',
      level: 'high' as const,
      description: 'Recent interactions show negative sentiment'
    });
  }

  return risks;
}

async function getTrendData(metric: string, startDate: string, endDate: string, database: Database): Promise<any[]> {
  try {
    switch (metric) {
      case 'interactions':
        return await database.query(
          `SELECT DATE(created_at) as date, COUNT(*) as value 
           FROM interactions 
           WHERE created_at BETWEEN $1 AND $2 
           GROUP BY DATE(created_at) 
           ORDER BY date`,
          [startDate, endDate]
        );

      case 'sentiment':
        return await database.query(
          `SELECT DATE(created_at) as date, AVG(sentiment_score::float) as value 
           FROM interactions 
           WHERE created_at BETWEEN $1 AND $2 
           AND sentiment_score IS NOT NULL 
           GROUP BY DATE(created_at) 
           ORDER BY date`,
          [startDate, endDate]
        );

      case 'resolution_time':
        return await database.query(
          `SELECT DATE(created_at) as date, AVG(resolution_time_minutes) as value 
           FROM interactions 
           WHERE created_at BETWEEN $1 AND $2 
           AND resolution_time_minutes IS NOT NULL 
           GROUP BY DATE(created_at) 
           ORDER BY date`,
          [startDate, endDate]
        );

      default:
        return [];
    }
  } catch {
    return [];
  }
}

function calculateAverageSentiment(sentimentData: any[]): number {
  if (sentimentData.length === 0) return 0.5;
  return sentimentData.reduce((sum, d) => sum + (d.value || 0), 0) / sentimentData.length;
}

function calculateAverageResolutionTime(resolutionData: any[]): number {
  if (resolutionData.length === 0) return 0;
  return resolutionData.reduce((sum, d) => sum + (d.value || 0), 0) / resolutionData.length;
}

function calculateChurnRisk(history: any[]): { score: number; factors: string[] } {
  const factors = [];
  let score = 0.1; // Base risk

  // Interaction frequency
  const recentInteractions = history.filter(h => 
    new Date(h.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );

  if (recentInteractions.length === 0) {
    score += 0.3;
    factors.push('No recent interactions');
  } else if (recentInteractions.length > 10) {
    score += 0.2;
    factors.push('High interaction volume');
  }

  // Sentiment analysis
  const sentimentScores = history
    .filter(h => h.sentiment_score !== null)
    .map(h => parseFloat(h.sentiment_score || 0));

  if (sentimentScores.length > 0) {
    const avgSentiment = sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length;
    if (avgSentiment < 0.3) {
      score += 0.4;
      factors.push('Poor sentiment history');
    }
  }

  return { score: Math.min(score, 1.0), factors };
}

function calculateNextContactProbability(history: any[]): number {
  if (history.length === 0) return 0.1;

  // Calculate average days between contacts
  const intervals = [];
  for (let i = 1; i < history.length; i++) {
    const prev = new Date(history[i - 1].created_at);
    const curr = new Date(history[i].created_at);
    intervals.push((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
  }

  if (intervals.length === 0) return 0.2;

  const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
  const daysSinceLastContact = (Date.now() - new Date(history[history.length - 1].created_at).getTime()) / (1000 * 60 * 60 * 24);

  // Simple probability based on average interval
  return Math.min(daysSinceLastContact / avgInterval, 1.0);
}

function predictSatisfaction(history: any[]): { predicted: number; confidence: number } {
  const recentHistory = history.slice(-10); // Last 10 interactions
  
  if (recentHistory.length === 0) {
    return { predicted: 0.5, confidence: 0.1 };
  }

  const sentimentScores = recentHistory
    .filter(h => h.sentiment_score !== null)
    .map(h => parseFloat(h.sentiment_score || 0));

  if (sentimentScores.length === 0) {
    return { predicted: 0.5, confidence: 0.2 };
  }

  const avgSentiment = sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length;
  const confidence = Math.min(sentimentScores.length / 10, 1.0);

  return { predicted: avgSentiment, confidence };
}

function assessEscalationRisk(history: any[]): { risk: 'low' | 'medium' | 'high'; score: number } {
  const recentHistory = history.slice(-5);
  
  if (recentHistory.length === 0) {
    return { risk: 'low', score: 0.1 };
  }

  let riskScore = 0;

  // Check for multiple recent contacts
  if (recentHistory.length >= 3) {
    riskScore += 0.3;
  }

  // Check for negative sentiment trend
  const sentimentScores = recentHistory
    .filter(h => h.sentiment_score !== null)
    .map(h => parseFloat(h.sentiment_score || 0));

  if (sentimentScores.length > 0) {
    const avgSentiment = sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length;
    if (avgSentiment < 0.3) {
      riskScore += 0.4;
    }
  }

  // Check for unresolved issues
  const unresolvedCount = recentHistory.filter(h => h.status !== 'resolved').length;
  riskScore += unresolvedCount * 0.1;

  const finalScore = Math.min(riskScore, 1.0);

  let risk: 'low' | 'medium' | 'high';
  if (finalScore < 0.3) risk = 'low';
  else if (finalScore < 0.7) risk = 'medium';
  else risk = 'high';

  return { risk, score: finalScore };
}

function calculatePredictionConfidence(historyLength: number): number {
  // Confidence increases with more data, plateaus at 20 interactions
  return Math.min(historyLength / 20, 0.9);
}