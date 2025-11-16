import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { RouteConfig } from './index';

const router = Router();

export const createEvaluationsRouter = (config: RouteConfig) => {
  const { logger } = config;

// Mock data for evaluations - In a real system, this would come from a database
const evaluationsData = [
  {
    id: 1,
    name: 'Fraud Detection Accuracy',
    description: 'Test model performance on detecting fraudulent transactions',
    status: 'completed',
    lastRun: '2024-12-15 10:30 AM',
    score: 94.2,
    testCases: 150,
    createdAt: '2024-12-10T10:00:00Z',
    updatedAt: '2024-12-15T10:30:00Z'
  },
  {
    id: 2,
    name: 'Risk Scoring Precision',
    description: 'Evaluate risk scoring algorithm accuracy',
    status: 'running',
    lastRun: '2024-12-15 11:00 AM',
    score: null,
    testCases: 200,
    createdAt: '2024-12-14T09:00:00Z',
    updatedAt: '2024-12-15T11:00:00Z'
  },
  {
    id: 3,
    name: 'Customer Sentiment Analysis',
    description: 'Test sentiment analysis on customer communications',
    status: 'pending',
    lastRun: '2024-12-14 3:00 PM',
    score: 87.5,
    testCases: 100,
    createdAt: '2024-12-12T08:00:00Z',
    updatedAt: '2024-12-14T15:00:00Z'
  },
  {
    id: 4,
    name: 'Transaction Pattern Recognition',
    description: 'Evaluate model ability to identify suspicious transaction patterns',
    status: 'completed',
    lastRun: '2024-12-13 2:15 PM',
    score: 92.8,
    testCases: 175,
    createdAt: '2024-12-11T14:00:00Z',
    updatedAt: '2024-12-13T14:15:00Z'
  },
  {
    id: 5,
    name: 'Identity Verification',
    description: 'Test accuracy of identity verification algorithms',
    status: 'completed',
    lastRun: '2024-12-12 9:45 AM',
    score: 96.1,
    testCases: 120,
    createdAt: '2024-12-09T11:00:00Z',
    updatedAt: '2024-12-12T09:45:00Z'
  },
  {
    id: 6,
    name: 'Money Laundering Detection',
    description: 'Evaluate AML model performance on complex transaction chains',
    status: 'completed',
    lastRun: '2024-12-11 4:30 PM',
    score: 89.7,
    testCases: 300,
    createdAt: '2024-12-08T10:00:00Z',
    updatedAt: '2024-12-11T16:30:00Z'
  }
];

// GET /evaluations - Get all evaluations with optional filtering and pagination
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = '1',
      limit = '10',
      status,
      sort = 'updatedAt',
      order = 'desc'
    } = req.query;

    logger.info('Fetching evaluations', {
      page,
      limit,
      status,
      sort,
      order
    });

    let filteredEvaluations = [...evaluationsData];

    // Filter by status if provided
    if (status && typeof status === 'string') {
      filteredEvaluations = filteredEvaluations.filter(
        evaluation => evaluation.status === status
      );
    }

    // Sort evaluations
    filteredEvaluations.sort((a, b) => {
      const sortField = sort as keyof typeof a;
      let aValue = a[sortField];
      let bValue = b[sortField];

      if (sortField === 'score') {
        // Handle null scores by treating them as 0 for sorting
        aValue = aValue || 0;
        bValue = bValue || 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue);
        return order === 'desc' ? -comparison : comparison;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        const comparison = aValue - bValue;
        return order === 'desc' ? -comparison : comparison;
      }

      return 0;
    });

    // Pagination
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;
    const paginatedEvaluations = filteredEvaluations.slice(offset, offset + limitNum);

    // Calculate summary stats
    const completedEvaluations = evaluationsData.filter(e => e.status === 'completed');
    const averageScore = completedEvaluations.length > 0 
      ? completedEvaluations.reduce((sum, e) => sum + (e.score || 0), 0) / completedEvaluations.length 
      : 0;
    const activeTests = evaluationsData.filter(e => e.status === 'running').length;

    const response = {
      evaluations: paginatedEvaluations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredEvaluations.length,
        totalPages: Math.ceil(filteredEvaluations.length / limitNum)
      },
      summary: {
        totalEvaluations: evaluationsData.length,
        averageScore: Math.round(averageScore * 10) / 10,
        activeTests
      }
    };

    logger.info('Evaluations fetched successfully', {
      count: paginatedEvaluations.length,
      total: filteredEvaluations.length
    });

    res.json(response);
  } catch (error) {
    logger.error('Failed to fetch evaluations', { error });
    next(error);
  }
});

// GET /evaluations/:id - Get specific evaluation
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const evaluationId = parseInt(id, 10);

    logger.info('Fetching evaluation by ID', { id: evaluationId });

    const evaluation = evaluationsData.find(e => e.id === evaluationId);

    if (!evaluation) {
      return res.status(404).json({
        error: 'Evaluation not found',
        message: `Evaluation with ID ${evaluationId} does not exist`
      });
    }

    logger.info('Evaluation fetched successfully', { id: evaluationId });
    res.json(evaluation);
  } catch (error) {
    logger.error('Failed to fetch evaluation', { error, id: req.params.id });
    next(error);
  }
});

// POST /evaluations/:id/run - Trigger a new evaluation run
router.post('/:id/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const evaluationId = parseInt(id, 10);

    logger.info('Triggering evaluation run', { id: evaluationId });

    const evaluation = evaluationsData.find(e => e.id === evaluationId);

    if (!evaluation) {
      return res.status(404).json({
        error: 'Evaluation not found',
        message: `Evaluation with ID ${evaluationId} does not exist`
      });
    }

    // Update status to running (simulate starting a test)
    evaluation.status = 'running';
    evaluation.lastRun = new Date().toLocaleString();
    evaluation.updatedAt = new Date().toISOString();
    evaluation.score = null; // Reset score while running

    logger.info('Evaluation run triggered successfully', { id: evaluationId });

    res.json({
      message: 'Evaluation run started successfully',
      evaluation
    });
  } catch (error) {
    logger.error('Failed to trigger evaluation run', { error, id: req.params.id });
    next(error);
  }
});

  return router;
};

export default createEvaluationsRouter;