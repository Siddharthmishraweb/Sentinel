import { Logger } from 'winston';
import { Database } from '../utils/database';

export interface ComplianceCheck {
  check_name: string;
  passed: boolean;
  reason?: string;
  policy_reference?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface ComplianceResult {
  overall_status: 'approved' | 'requires_review' | 'denied';
  checks: ComplianceCheck[];
  required_actions: string[];
  otp_required: boolean;
  approval_level: 'agent' | 'lead' | 'compliance_officer';
  policy_violations: string[];
}

export class ComplianceAgent {
  private database: Database;
  private logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  async validateAction(
    action: string, 
    customerId: string, 
    amount?: number, 
    context?: any
  ): Promise<ComplianceResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting compliance validation', { 
        action, 
        customerId, 
        amount 
      });

      const result: ComplianceResult = {
        overall_status: 'approved',
        checks: [],
        required_actions: [],
        otp_required: false,
        approval_level: 'agent',
        policy_violations: []
      };

      // Get customer information
      const customer = await this.getCustomerInfo(customerId);
      if (!customer) {
        result.checks.push({
          check_name: 'customer_exists',
          passed: false,
          reason: 'Customer not found',
          severity: 'critical'
        });
        result.overall_status = 'denied';
        return result;
      }

      // Common compliance checks
      await this.checkKYCStatus(customer, result);
      await this.checkAccountStatus(customer, result);
      
      // Action-specific compliance checks
      switch (action.toLowerCase()) {
        case 'freeze_card':
          await this.validateFreezeCard(customer, amount, context, result);
          break;
          
        case 'open_dispute':
          await this.validateOpenDispute(customer, amount, context, result);
          break;
          
        case 'contact_customer':
          await this.validateContactCustomer(customer, context, result);
          break;
          
        case 'unfreeze_card':
          await this.validateUnfreezeCard(customer, context, result);
          break;
          
        default:
          result.checks.push({
            check_name: 'unknown_action',
            passed: false,
            reason: `Unknown action: ${action}`,
            severity: 'error'
          });
          result.overall_status = 'denied';
      }

      // Aggregate results
      this.aggregateComplianceResults(result);

      const duration = Date.now() - startTime;
      this.logger.info('Compliance validation completed', {
        action,
        customerId,
        overallStatus: result.overall_status,
        checksPerformed: result.checks.length,
        duration
      });

      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error('Compliance validation failed', {
        action,
        customerId,
        duration,
        error: error.message
      });
      
      return {
        overall_status: 'denied',
        checks: [{
          check_name: 'system_error',
          passed: false,
          reason: 'Compliance system unavailable',
          severity: 'critical'
        }],
        required_actions: ['System administrator review required'],
        otp_required: false,
        approval_level: 'compliance_officer',
        policy_violations: ['SYSTEM_ERROR']
      };
    }
  }

  async validateOTP(customerId: string, otp: string): Promise<boolean> {
    try {
      this.logger.info('Validating OTP', { customerId });

      // Simple OTP validation (in production, this would be more sophisticated)
      const validOTPs = ['123456', '000000', '111111']; // Demo OTPs
      
      if (validOTPs.includes(otp)) {
        this.logger.info('OTP validated successfully', { customerId });
        return true;
      }

      this.logger.warn('OTP validation failed', { customerId, otp: 'REDACTED' });
      return false;

    } catch (error: any) {
      this.logger.error('OTP validation error', { customerId, error: error.message });
      return false;
    }
  }

  private async getCustomerInfo(customerId: string): Promise<any> {
    try {
      const query = 'SELECT * FROM customers WHERE id = $1';
      const results = await this.database.query(query, [customerId]) as any[];
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.logger.error('Failed to get customer info', { customerId, error });
      return null;
    }
  }

  private async checkKYCStatus(customer: any, result: ComplianceResult): Promise<void> {
    const kycStatus = customer.kyc_level || 'NONE';
    
    if (kycStatus === 'BASIC' || kycStatus === 'ENHANCED' || kycStatus === 'PREMIUM') {
      result.checks.push({
        check_name: 'kyc_verification',
        passed: true,
        reason: `KYC verified at ${kycStatus} level`,
        policy_reference: 'POL-KYC-001',
        severity: 'info'
      });
    } else {
      result.checks.push({
        check_name: 'kyc_verification',
        passed: false,
        reason: 'Customer KYC not verified',
        policy_reference: 'POL-KYC-001',
        severity: 'critical'
      });
      result.policy_violations.push('INCOMPLETE_KYC');
    }
  }

  private async checkAccountStatus(customer: any, result: ComplianceResult): Promise<void> {
    // Check if customer account is active
    const accountActive = customer.status !== 'CLOSED' && customer.status !== 'SUSPENDED';
    
    result.checks.push({
      check_name: 'account_status',
      passed: accountActive,
      reason: accountActive ? 'Account is active' : `Account status: ${customer.status}`,
      policy_reference: 'POL-ACC-001',
      severity: accountActive ? 'info' : 'error'
    });

    if (!accountActive) {
      result.policy_violations.push('INACTIVE_ACCOUNT');
    }
  }

  private async validateFreezeCard(
    customer: any, 
    amount: number | undefined, 
    context: any, 
    result: ComplianceResult
  ): Promise<void> {
    
    // Check if card is already frozen
    if (context?.card_status === 'FROZEN') {
      result.checks.push({
        check_name: 'card_already_frozen',
        passed: false,
        reason: 'Card is already frozen',
        severity: 'error'
      });
      return;
    }

    // Freeze actions over $10,000 require OTP
    if (amount && amount > 10000) {
      result.otp_required = true;
      result.checks.push({
        check_name: 'high_amount_otp',
        passed: true,
        reason: 'High amount transaction requires OTP verification',
        policy_reference: 'POL-OTP-001',
        severity: 'warning'
      });
    }

    // Enhanced KYC customers get expedited processing
    if (customer.kyc_level === 'ENHANCED' || customer.kyc_level === 'PREMIUM') {
      result.approval_level = 'agent';
    } else {
      result.approval_level = 'lead';
      result.checks.push({
        check_name: 'kyc_level_review',
        passed: true,
        reason: 'Basic KYC requires lead approval for card freeze',
        policy_reference: 'POL-FREEZE-001',
        severity: 'warning'
      });
    }
  }

  private async validateOpenDispute(
    customer: any, 
    amount: number | undefined, 
    context: any, 
    result: ComplianceResult
  ): Promise<void> {
    
    // Check dispute amount limits
    if (amount && amount > 25000) {
      result.approval_level = 'compliance_officer';
      result.checks.push({
        check_name: 'high_amount_dispute',
        passed: true,
        reason: 'High amount disputes require compliance officer review',
        policy_reference: 'POL-DISPUTE-001',
        severity: 'warning'
      });
    }

    // Check if customer has too many recent disputes
    const recentDisputeCount = await this.getRecentDisputeCount(customer.id);
    if (recentDisputeCount > 3) {
      result.checks.push({
        check_name: 'dispute_frequency',
        passed: false,
        reason: `Customer has ${recentDisputeCount} disputes in past 90 days`,
        policy_reference: 'POL-DISPUTE-002',
        severity: 'error'
      });
      result.policy_violations.push('EXCESSIVE_DISPUTES');
    }

    // Transaction age check
    if (context?.transaction_age_days > 120) {
      result.checks.push({
        check_name: 'transaction_age',
        passed: false,
        reason: 'Transaction is too old for dispute (>120 days)',
        policy_reference: 'POL-DISPUTE-003',
        severity: 'error'
      });
      result.policy_violations.push('DISPUTE_TIME_LIMIT');
    }
  }

  private async validateContactCustomer(
    customer: any, 
    context: any, 
    result: ComplianceResult
  ): Promise<void> {
    
    // Check contact preferences and frequency
    const recentContactCount = await this.getRecentContactCount(customer.id);
    if (recentContactCount > 5) {
      result.checks.push({
        check_name: 'contact_frequency',
        passed: false,
        reason: 'Customer has been contacted frequently (>5 times in 7 days)',
        policy_reference: 'POL-CONTACT-001',
        severity: 'warning'
      });
    }

    // Verify contact method is appropriate
    const contactMethod = context?.communication_type || 'email';
    if (contactMethod === 'phone' && !customer.phone) {
      result.checks.push({
        check_name: 'phone_availability',
        passed: false,
        reason: 'Phone contact requested but no phone number on file',
        severity: 'error'
      });
    }
  }

  private async validateUnfreezeCard(
    customer: any, 
    context: any, 
    result: ComplianceResult
  ): Promise<void> {
    
    // Always require OTP for unfreezing
    result.otp_required = true;
    
    // Require identity verification
    result.required_actions.push('identity_verification');
    
    result.checks.push({
      check_name: 'unfreeze_verification',
      passed: true,
      reason: 'Card unfreeze requires OTP and identity verification',
      policy_reference: 'POL-UNFREEZE-001',
      severity: 'warning'
    });
  }

  private async getRecentDisputeCount(customerId: string): Promise<number> {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM cases 
        WHERE customer_id = $1 
          AND type = 'DISPUTE' 
          AND created_at >= NOW() - INTERVAL '90 days'
      `;
      const results = await this.database.query(query, [customerId]) as any[];
      return results[0]?.count || 0;
    } catch (error) {
      this.logger.error('Failed to get dispute count', { customerId, error });
      return 0;
    }
  }

  private async getRecentContactCount(customerId: string): Promise<number> {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM case_events 
        WHERE payload_json->>'customer_id' = $1 
          AND action = 'CUSTOMER_CONTACTED'
          AND ts >= NOW() - INTERVAL '7 days'
      `;
      const results = await this.database.query(query, [customerId]) as any[];
      return results[0]?.count || 0;
    } catch (error) {
      this.logger.error('Failed to get contact count', { customerId, error });
      return 0;
    }
  }

  private aggregateComplianceResults(result: ComplianceResult): void {
    const failedChecks = result.checks.filter(check => !check.passed);
    const criticalFailures = failedChecks.filter(check => check.severity === 'critical');
    const errorFailures = failedChecks.filter(check => check.severity === 'error');

    if (criticalFailures.length > 0 || result.policy_violations.length > 0) {
      result.overall_status = 'denied';
    } else if (errorFailures.length > 0 || result.otp_required) {
      result.overall_status = 'requires_review';
    } else {
      result.overall_status = 'approved';
    }

    // Add general required actions based on status
    if (result.otp_required) {
      result.required_actions.push('otp_verification');
    }

    if (result.approval_level === 'lead') {
      result.required_actions.push('lead_approval');
    }

    if (result.approval_level === 'compliance_officer') {
      result.required_actions.push('compliance_officer_review');
    }
  }
}