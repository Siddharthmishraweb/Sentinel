import { Logger } from 'winston';
import { Database } from '../utils/database';

export interface FraudAnalysis {
  score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
  recommended_action?: 'monitor' | 'review' | 'freeze_card' | 'block_transaction';
  confidence: number;
  checks_performed: string[];
}

export class FraudAgent {
  private database: Database;
  private logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  async analyzeRisk(customerId: string, transactionId?: string): Promise<FraudAnalysis> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting fraud analysis', { customerId, transactionId });

      const analysis: FraudAnalysis = {
        score: 0,
        risk_level: 'low',
        reasons: [],
        confidence: 0.95,
        checks_performed: []
      };

      // Get customer transaction history
      const historyQuery = `
        SELECT * FROM transactions 
        WHERE customer_id = $1 
          AND transaction_date >= NOW() - INTERVAL '90 days'
        ORDER BY transaction_date DESC
      `;
      
      const history = await this.database.query(historyQuery, [customerId]) as any[];
      analysis.checks_performed.push('transaction_history');

      if (history.length === 0) {
        analysis.reasons.push('No transaction history available');
        analysis.confidence = 0.7;
        return analysis;
      }

      // Velocity Check
      const velocityRisk = this.checkVelocity(history);
      analysis.score += velocityRisk.score;
      if (velocityRisk.reasons.length > 0) {
        analysis.reasons.push(...velocityRisk.reasons);
      }
      analysis.checks_performed.push('velocity_check');

      // Amount Anomaly Check
      const amountRisk = this.checkAmountAnomalies(history);
      analysis.score += amountRisk.score;
      if (amountRisk.reasons.length > 0) {
        analysis.reasons.push(...amountRisk.reasons);
      }
      analysis.checks_performed.push('amount_anomaly');

      // Merchant Risk Check
      const merchantRisk = this.checkMerchantRisk(history);
      analysis.score += merchantRisk.score;
      if (merchantRisk.reasons.length > 0) {
        analysis.reasons.push(...merchantRisk.reasons);
      }
      analysis.checks_performed.push('merchant_risk');

      // Geographic Risk Check
      const geoRisk = this.checkGeographicRisk(history);
      analysis.score += geoRisk.score;
      if (geoRisk.reasons.length > 0) {
        analysis.reasons.push(...geoRisk.reasons);
      }
      analysis.checks_performed.push('geographic_risk');

      // Device/Pattern Check
      const deviceRisk = this.checkDevicePatterns(history);
      analysis.score += deviceRisk.score;
      if (deviceRisk.reasons.length > 0) {
        analysis.reasons.push(...deviceRisk.reasons);
      }
      analysis.checks_performed.push('device_patterns');

      // Check for prior chargebacks
      const chargebackRisk = await this.checkChargebackHistory(customerId);
      analysis.score += chargebackRisk.score;
      if (chargebackRisk.reasons.length > 0) {
        analysis.reasons.push(...chargebackRisk.reasons);
      }
      analysis.checks_performed.push('chargeback_history');

      // Determine risk level and recommended action
      analysis.risk_level = this.determineRiskLevel(analysis.score);
      analysis.recommended_action = this.getRecommendedAction(analysis.risk_level, analysis.score);

      const duration = Date.now() - startTime;
      this.logger.info('Fraud analysis completed', {
        customerId,
        transactionId,
        riskScore: analysis.score,
        riskLevel: analysis.risk_level,
        duration,
        checksPerformed: analysis.checks_performed.length
      });

      return analysis;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error('Fraud analysis failed', {
        customerId,
        transactionId,
        duration,
        error: error.message
      });
      throw error;
    }
  }

  private checkVelocity(transactions: any[]): { score: number; reasons: string[] } {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const recent24h = transactions.filter(t => new Date(t.transaction_date) >= last24h);
    const recentHour = transactions.filter(t => new Date(t.transaction_date) >= lastHour);

    const score = Math.min(
      recent24h.length * 0.5 + recentHour.length * 2,
      15
    );

    const reasons: string[] = [];
    
    if (recent24h.length > 20) {
      reasons.push(`High velocity: ${recent24h.length} transactions in 24 hours`);
    }
    
    if (recentHour.length > 5) {
      reasons.push(`Burst activity: ${recentHour.length} transactions in last hour`);
    }

    return { score, reasons };
  }

  private checkAmountAnomalies(transactions: any[]): { score: number; reasons: string[] } {
    const amounts = transactions.map(t => t.amount_cents / 100);
    const avgAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
    const maxAmount = Math.max(...amounts);
    
    let score = 0;
    const reasons: string[] = [];

    // Check for unusually large transactions
    if (maxAmount > avgAmount * 10) {
      score += 8;
      reasons.push(`Large transaction detected: $${maxAmount.toFixed(2)} vs avg $${avgAmount.toFixed(2)}`);
    } else if (maxAmount > avgAmount * 5) {
      score += 4;
      reasons.push(`Above-average transaction: $${maxAmount.toFixed(2)} vs avg $${avgAmount.toFixed(2)}`);
    }

    // Check for round number bias (possible money laundering)
    const roundNumbers = amounts.filter(amt => amt % 100 === 0 && amt >= 1000);
    if (roundNumbers.length > amounts.length * 0.3) {
      score += 3;
      reasons.push(`Suspicious round number pattern: ${roundNumbers.length}/${amounts.length} transactions`);
    }

    return { score, reasons };
  }

  private checkMerchantRisk(transactions: any[]): { score: number; reasons: string[] } {
    const merchantCategories = new Map<string, number>();
    const merchants = new Map<string, number>();

    transactions.forEach(t => {
      merchantCategories.set(t.merchant_category, (merchantCategories.get(t.merchant_category) || 0) + 1);
      merchants.set(t.merchant_name, (merchants.get(t.merchant_name) || 0) + 1);
    });

    let score = 0;
    const reasons: string[] = [];

    // Check for high-risk MCC codes
    const highRiskMCCs = ['5993', '7995', '5122']; // Direct marketing, gambling, drugs
    for (const [mcc, count] of merchantCategories.entries()) {
      if (highRiskMCCs.includes(mcc)) {
        score += count * 2;
        reasons.push(`High-risk merchant category: ${mcc} (${count} transactions)`);
      }
    }

    // Check for merchant concentration
    const topMerchant = Array.from(merchants.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topMerchant && topMerchant[1] > transactions.length * 0.4) {
      score += 3;
      reasons.push(`High concentration at ${topMerchant[0]}: ${topMerchant[1]} transactions`);
    }

    return { score, reasons };
  }

  private checkGeographicRisk(transactions: any[]): { score: number; reasons: string[] } {
    const countries = new Set<string>();
    const cities = new Set<string>();

    transactions.forEach(t => {
      if (t.country) countries.add(t.country);
      if (t.city) cities.add(t.city);
    });

    let score = 0;
    const reasons: string[] = [];

    // International activity
    if (countries.size > 1) {
      const internationalCount = Array.from(countries).filter(c => c !== 'US').length;
      score += internationalCount * 2;
      reasons.push(`International activity: ${countries.size} countries`);
    }

    // High geographic dispersion
    if (cities.size > 10) {
      score += Math.min(cities.size - 10, 5);
      reasons.push(`High geographic spread: ${cities.size} different cities`);
    }

    return { score, reasons };
  }

  private checkDevicePatterns(transactions: any[]): { score: number; reasons: string[] } {
    const devices = new Set<string>();
    const now = new Date();
    const recentTransactions = transactions.filter(t => 
      new Date(t.transaction_date) >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    );

    recentTransactions.forEach(t => {
      if (t.device_id) devices.add(t.device_id);
    });

    let score = 0;
    const reasons: string[] = [];

    // Multiple devices in short time period
    if (devices.size > 3) {
      score += (devices.size - 3) * 2;
      reasons.push(`Multiple devices: ${devices.size} devices in past week`);
    }

    // Device switching pattern
    if (devices.size > 1 && recentTransactions.length > 0) {
      const deviceChanges = this.countDeviceChanges(recentTransactions);
      if (deviceChanges > 2) {
        score += deviceChanges;
        reasons.push(`Frequent device switching: ${deviceChanges} changes`);
      }
    }

    return { score, reasons };
  }

  private countDeviceChanges(transactions: any[]): number {
    let changes = 0;
    let lastDevice: string | null = null;

    transactions.sort((a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime());

    for (const txn of transactions) {
      if (txn.device_id) {
        if (lastDevice && lastDevice !== txn.device_id) {
          changes++;
        }
        lastDevice = txn.device_id;
      }
    }

    return changes;
  }

  private async checkChargebackHistory(customerId: string): Promise<{ score: number; reasons: string[] }> {
    try {
      // Check for prior chargebacks
      const chargebackQuery = `
        SELECT COUNT(*) as chargeback_count 
        FROM cases 
        WHERE customer_id = $1 
          AND type = 'CHARGEBACK' 
          AND created_at >= NOW() - INTERVAL '12 months'
      `;
      
      const result = await this.database.query(chargebackQuery, [customerId]) as any[];
      const chargebackCount = result[0]?.chargeback_count || 0;

      let score = 0;
      const reasons: string[] = [];

      if (chargebackCount > 0) {
        score += chargebackCount * 5;
        reasons.push(`Prior chargebacks: ${chargebackCount} in past 12 months`);
      }

      return { score, reasons };
    } catch (error) {
      this.logger.warn('Failed to check chargeback history', { customerId, error });
      return { score: 0, reasons: [] };
    }
  }

  private determineRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 20) return 'critical';
    if (score >= 12) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  }

  private getRecommendedAction(riskLevel: string, score: number): 'monitor' | 'review' | 'freeze_card' | 'block_transaction' {
    switch (riskLevel) {
      case 'critical':
        return score >= 25 ? 'freeze_card' : 'block_transaction';
      case 'high':
        return 'review';
      case 'medium':
        return 'review';
      default:
        return 'monitor';
    }
  }
}