import { Logger } from 'winston';
import { Database } from '../utils/database';

export interface InsightsData {
  categories: { category: string; amount: number; count: number; percentage: number }[];
  merchants: { merchant: string; amount: number; count: number; percentage: number }[];
  anomalies: { type: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  monthlyTrend: { month: string; amount: number; count: number }[];
  totalAmount: number;
  totalTransactions: number;
  averageTransactionAmount: number;
}

export class InsightsAgent {
  private database: Database;
  private logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  async generateInsights(customerId: string, days: number = 90): Promise<InsightsData> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Generating customer insights', { customerId, days });

      // Get transactions for the specified period
      const query = `
        SELECT 
          t.*,
          c.name as customer_name
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id::text
        WHERE t.customer_id = $1
          AND t.transaction_date >= NOW() - INTERVAL '${days} days'
          AND t.status = 'completed'
        ORDER BY t.transaction_date DESC
      `;

      const result = await this.database.query(query, [customerId]);
      const transactions = result as any[];

      if (transactions.length === 0) {
        return this.getEmptyInsights();
      }

      // Calculate total metrics
      const totalAmount = transactions.reduce((sum: number, t: any) => sum + (t.amount_cents / 100), 0);
      const totalTransactions = transactions.length;
      const averageTransactionAmount = totalAmount / totalTransactions;

      // Category analysis
      const categoryMap = new Map<string, { amount: number; count: number }>();
      transactions.forEach((t: any) => {
        const category = this.getMerchantCategory(t.merchant_category);
        const existing = categoryMap.get(category) || { amount: 0, count: 0 };
        categoryMap.set(category, {
          amount: existing.amount + (t.amount_cents / 100),
          count: existing.count + 1
        });
      });

      const categories = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count,
        percentage: (data.amount / totalAmount) * 100
      })).sort((a, b) => b.amount - a.amount);

      // Merchant analysis
      const merchantMap = new Map<string, { amount: number; count: number }>();
      transactions.forEach((t: any) => {
        const existing = merchantMap.get(t.merchant_name) || { amount: 0, count: 0 };
        merchantMap.set(t.merchant_name, {
          amount: existing.amount + (t.amount_cents / 100),
          count: existing.count + 1
        });
      });

      const merchants = Array.from(merchantMap.entries()).map(([merchant, data]) => ({
        merchant,
        amount: data.amount,
        count: data.count,
        percentage: (data.amount / totalAmount) * 100
      })).sort((a, b) => b.amount - a.amount).slice(0, 10);

      // Anomaly detection (simple rules-based)
      const anomalies = this.detectAnomalies(transactions, averageTransactionAmount);

      // Monthly trend
      const monthlyTrend = this.calculateMonthlyTrend(transactions);

      const insights = {
        categories,
        merchants,
        anomalies,
        monthlyTrend,
        totalAmount,
        totalTransactions,
        averageTransactionAmount
      };

      const duration = Date.now() - startTime;
      this.logger.info('Insights generated successfully', { 
        customerId, 
        duration,
        transactionCount: totalTransactions,
        categoriesFound: categories.length,
        anomaliesFound: anomalies.length
      });

      return insights;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to generate insights', {
        customerId,
        duration,
        error: error.message
      });
      throw error;
    }
  }

  private getMerchantCategory(mcc: string): string {
    const categoryMap: { [key: string]: string } = {
      '5411': 'Grocery',
      '5812': 'Restaurant',
      '5542': 'Gas Station',
      '5331': 'Retail',
      '4121': 'Transportation',
      '5999': 'Miscellaneous',
      '5735': 'Entertainment',
      '5945': 'Toys/Games'
    };
    return categoryMap[mcc] || 'Other';
  }

  private detectAnomalies(transactions: any[], averageAmount: number): any[] {
    const anomalies: any[] = [];

    // Large transaction anomaly
    const largeTransactions = transactions.filter(t => (t.amount_cents / 100) > averageAmount * 5);
    if (largeTransactions.length > 0) {
      anomalies.push({
        type: 'large_transaction',
        description: `${largeTransactions.length} transaction(s) significantly above average`,
        severity: largeTransactions.length > 2 ? 'high' : 'medium' as 'high' | 'medium'
      });
    }

    // High frequency at single merchant
    const merchantFreq = new Map<string, number>();
    transactions.forEach(t => {
      merchantFreq.set(t.merchant_name, (merchantFreq.get(t.merchant_name) || 0) + 1);
    });

    const highFreqMerchants = Array.from(merchantFreq.entries()).filter(([_, count]) => count > 10);
    if (highFreqMerchants.length > 0) {
      anomalies.push({
        type: 'high_frequency',
        description: `High frequency transactions at ${highFreqMerchants[0][0]} (${highFreqMerchants[0][1]} times)`,
        severity: 'medium' as 'medium'
      });
    }

    // International transactions
    const internationalTxns = transactions.filter(t => t.country && t.country !== 'US');
    if (internationalTxns.length > 0) {
      anomalies.push({
        type: 'international',
        description: `${internationalTxns.length} international transaction(s) detected`,
        severity: 'low' as 'low'
      });
    }

    return anomalies;
  }

  private calculateMonthlyTrend(transactions: any[]): any[] {
    const monthlyMap = new Map<string, { amount: number; count: number }>();

    transactions.forEach(t => {
      const date = new Date(t.transaction_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlyMap.get(monthKey) || { amount: 0, count: 0 };
      monthlyMap.set(monthKey, {
        amount: existing.amount + (t.amount_cents / 100),
        count: existing.count + 1
      });
    });

    return Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        amount: data.amount,
        count: data.count
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private getEmptyInsights(): InsightsData {
    return {
      categories: [],
      merchants: [],
      anomalies: [],
      monthlyTrend: [],
      totalAmount: 0,
      totalTransactions: 0,
      averageTransactionAmount: 0
    };
  }
}