import { Logger } from 'winston';

export interface SummaryContext {
  customer_id: string;
  alert_id?: string;
  transaction_id?: string;
  risk_score?: number;
  risk_level?: string;
  fraud_reasons?: string[];
  insights?: any;
  compliance_result?: any;
  recommended_action?: string;
  kb_citations?: any[];
}

export interface SummaryResult {
  customer_message: string;
  internal_note: string;
  action_summary: string;
  risk_assessment: string;
  next_steps: string[];
  template_used: string;
  fallback_used: boolean;
}

export class SummarizerAgent {
  private logger: Logger;
  private templates: Map<string, any>;

  constructor(logger: Logger) {
    this.logger = logger;
    this.templates = new Map();
    this.initializeTemplates();
  }

  async generateSummary(context: SummaryContext, action?: string): Promise<SummaryResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Generating summary', { 
        customerId: context.customer_id, 
        action,
        riskLevel: context.risk_level 
      });

      const templateKey = this.selectTemplate(action, context.risk_level);
      const template = this.templates.get(templateKey);

      if (!template) {
        return this.generateFallbackSummary(context, action || 'review');
      }

      const summary: SummaryResult = {
        customer_message: this.generateCustomerMessage(template, context),
        internal_note: this.generateInternalNote(template, context),
        action_summary: this.generateActionSummary(template, context, action),
        risk_assessment: this.generateRiskAssessment(context),
        next_steps: this.generateNextSteps(context, action),
        template_used: templateKey,
        fallback_used: false
      };

      const duration = Date.now() - startTime;
      this.logger.info('Summary generated successfully', {
        customerId: context.customer_id,
        templateUsed: templateKey,
        duration
      });

      return summary;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error('Summary generation failed', {
        customerId: context.customer_id,
        action,
        duration,
        error: error.message
      });

      return this.generateFallbackSummary(context, action || 'review');
    }
  }

  private initializeTemplates(): void {
    this.templates.set('freeze_card_high', {
      customer_message: "We've temporarily secured your card due to unusual activity. Your account remains safe and we'll contact you within 24 hours to verify recent transactions.",
      internal_note: "Card frozen due to high-risk activity detection. Risk score: {risk_score}. Primary concerns: {fraud_reasons}",
      action_type: "FREEZE_CARD",
      risk_threshold: "high"
    });

    this.templates.set('freeze_card_medium', {
      customer_message: "We've temporarily paused your card as a precautionary measure. Please call us at your earliest convenience to verify recent activity.",
      internal_note: "Preventive card freeze for medium-risk activity. Risk score: {risk_score}. Factors: {fraud_reasons}",
      action_type: "FREEZE_CARD",
      risk_threshold: "medium"
    });

    this.templates.set('open_dispute', {
      customer_message: "We've initiated a dispute for the transaction you reported. You'll receive updates within 5-7 business days. A provisional credit may be applied to your account.",
      internal_note: "Dispute opened for transaction {transaction_id}. Amount: {amount}. Reason: {dispute_reason}",
      action_type: "OPEN_DISPUTE"
    });

    this.templates.set('contact_customer', {
      customer_message: "We're reaching out regarding recent activity on your account. Please respond at your earliest convenience to help us verify your identity and transactions.",
      internal_note: "Customer contact initiated for verification. Method: {contact_method}. Reason: {contact_reason}",
      action_type: "CONTACT_CUSTOMER"
    });

    this.templates.set('false_positive', {
      customer_message: "After review, we've determined the recent activity on your account is legitimate. No further action is required.",
      internal_note: "Alert marked as false positive. Original risk score: {risk_score}. Review notes: {review_notes}",
      action_type: "FALSE_POSITIVE"
    });

    this.templates.set('review_required', {
      customer_message: "We're reviewing recent activity on your account and may contact you for additional verification. Your account remains fully functional.",
      internal_note: "Manual review required. Risk level: {risk_level}. Compliance status: {compliance_status}",
      action_type: "MANUAL_REVIEW"
    });
  }

  private selectTemplate(action?: string, riskLevel?: string): string {
    if (!action) return 'review_required';

    const actionLower = action.toLowerCase();
    
    if (actionLower.includes('freeze')) {
      return riskLevel === 'high' ? 'freeze_card_high' : 'freeze_card_medium';
    }
    
    if (actionLower.includes('dispute')) {
      return 'open_dispute';
    }
    
    if (actionLower.includes('contact')) {
      return 'contact_customer';
    }
    
    if (actionLower.includes('false') || actionLower.includes('positive')) {
      return 'false_positive';
    }

    return 'review_required';
  }

  private generateCustomerMessage(template: any, context: SummaryContext): string {
    let message = template.customer_message;

    // Replace placeholders with actual values
    message = this.replacePlaceholders(message, {
      risk_score: context.risk_score?.toString() || 'N/A',
      risk_level: context.risk_level || 'unknown',
      customer_id: this.maskCustomerId(context.customer_id),
      transaction_id: context.transaction_id || 'N/A',
      alert_id: context.alert_id || 'N/A'
    });

    return message;
  }

  private generateInternalNote(template: any, context: SummaryContext): string {
    let note = template.internal_note;

    const fraudReasonsText = context.fraud_reasons?.join(', ') || 'No specific reasons identified';
    const complianceStatus = context.compliance_result?.overall_status || 'not_checked';

    note = this.replacePlaceholders(note, {
      risk_score: context.risk_score?.toString() || 'N/A',
      risk_level: context.risk_level || 'unknown',
      fraud_reasons: fraudReasonsText,
      compliance_status: complianceStatus,
      customer_id: context.customer_id,
      transaction_id: context.transaction_id || 'N/A',
      alert_id: context.alert_id || 'N/A',
      timestamp: new Date().toISOString()
    });

    // Add insights summary if available
    if (context.insights) {
      note += ` | Insights: ${context.insights.totalTransactions} transactions, avg $${context.insights.averageTransactionAmount?.toFixed(2) || 'N/A'}`;
    }

    return note;
  }

  private generateActionSummary(template: any, context: SummaryContext, action?: string): string {
    const actionType = action || template.action_type || 'REVIEW';
    const riskLevel = context.risk_level || 'unknown';
    const riskScore = context.risk_score || 0;

    let summary = `Action: ${actionType.toUpperCase()} | Risk: ${riskLevel.toUpperCase()} (${riskScore})`;

    if (context.recommended_action) {
      summary += ` | Recommended: ${context.recommended_action}`;
    }

    if (context.compliance_result?.otp_required) {
      summary += ` | OTP Required`;
    }

    if (context.kb_citations && context.kb_citations.length > 0) {
      summary += ` | KB Citations: ${context.kb_citations.length}`;
    }

    return summary;
  }

  private generateRiskAssessment(context: SummaryContext): string {
    const riskLevel = context.risk_level || 'unknown';
    const riskScore = context.risk_score || 0;
    const reasons = context.fraud_reasons || [];

    let assessment = `Risk Level: ${riskLevel.toUpperCase()} (Score: ${riskScore})`;

    if (reasons.length > 0) {
      assessment += `\nKey Risk Factors: ${reasons.slice(0, 3).join(', ')}`;
      if (reasons.length > 3) {
        assessment += ` and ${reasons.length - 3} others`;
      }
    }

    if (context.insights) {
      const insights = context.insights;
      assessment += `\nCustomer Profile: ${insights.totalTransactions} transactions, $${insights.totalAmount?.toFixed(2) || 'N/A'} total volume`;
      
      if (insights.anomalies && insights.anomalies.length > 0) {
        assessment += `\nAnomalies Detected: ${insights.anomalies.length}`;
      }
    }

    return assessment;
  }

  private generateNextSteps(context: SummaryContext, action?: string): string[] {
    const steps: string[] = [];

    if (context.compliance_result?.required_actions) {
      steps.push(...context.compliance_result.required_actions.map((action: string) => 
        `Complete ${action.replace(/_/g, ' ')}`
      ));
    }

    if (context.compliance_result?.otp_required) {
      steps.push('Obtain and verify OTP from customer');
    }

    if (context.recommended_action === 'review') {
      steps.push('Assign to senior analyst for manual review');
    }

    if (action?.toLowerCase().includes('freeze')) {
      steps.push('Monitor customer communication channels');
      steps.push('Document customer verification when contacted');
    }

    if (action?.toLowerCase().includes('dispute')) {
      steps.push('Gather supporting documentation');
      steps.push('Submit to payment network within required timeframe');
      steps.push('Update customer with status in 5-7 business days');
    }

    if (steps.length === 0) {
      steps.push('Monitor account activity');
      steps.push('Update case status as needed');
    }

    return steps;
  }

  private generateFallbackSummary(context: SummaryContext, action: string): SummaryResult {
    this.logger.warn('Using fallback summary template', { 
      customerId: context.customer_id, 
      action 
    });

    return {
      customer_message: "We're currently reviewing activity on your account. We'll contact you if any additional verification is needed.",
      internal_note: `Fallback summary generated for customer ${context.customer_id}. Action: ${action}. Risk: ${context.risk_level || 'unknown'}. Generated at ${new Date().toISOString()}`,
      action_summary: `${action.toUpperCase()} | Risk: ${context.risk_level || 'UNKNOWN'} | Fallback processing`,
      risk_assessment: `Risk Level: ${context.risk_level || 'UNKNOWN'} | Score: ${context.risk_score || 'N/A'} | Limited analysis available`,
      next_steps: [
        'Review case manually',
        'Contact customer if needed',
        'Update case status'
      ],
      template_used: 'fallback',
      fallback_used: true
    };
  }

  private replacePlaceholders(text: string, values: { [key: string]: string }): string {
    let result = text;
    
    Object.entries(values).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });

    return result;
  }

  private maskCustomerId(customerId: string): string {
    if (customerId.length <= 8) return customerId;
    return customerId.substring(0, 4) + '****' + customerId.substring(customerId.length - 4);
  }

  async generateQuickSummary(action: string, success: boolean, details?: string): Promise<string> {
    const timestamp = new Date().toLocaleString();
    
    if (success) {
      return `✓ ${action.toUpperCase()} completed successfully at ${timestamp}. ${details || ''}`;
    } else {
      return `✗ ${action.toUpperCase()} failed at ${timestamp}. ${details || 'Please review and retry.'}`;
    }
  }

  getAvailableTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  getTemplate(key: string): any {
    return this.templates.get(key) || null;
  }
}