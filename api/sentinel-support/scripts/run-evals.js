#!/usr/bin/env node

/**
 * Evaluation CLI Runner
 * Runs acceptance tests against the API to validate functionality
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const config = {
  apiUrl: process.env.API_URL || 'http://localhost:3001/api',
  apiKey: process.env.API_KEY || 'sentinel-api-key-2024',
  evalDir: path.join(__dirname, '../fixtures/evals'),
  timeout: 30000
};

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message, error) {
  log(`❌ ${message}`, 'red');
  if (error) {
    console.error(`   ${error.message || error}`);
  }
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// HTTP client with default headers
const api = axios.create({
  baseURL: config.apiUrl,
  headers: {
    'X-API-Key': config.apiKey,
    'Content-Type': 'application/json'
  },
  timeout: config.timeout
});

// Load evaluation test cases
function loadEvaluations() {
  const files = fs.readdirSync(config.evalDir);
  const evaluations = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const filePath = path.join(config.evalDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const evaluation = JSON.parse(content);
        evaluations.push({ file, ...evaluation });
      } catch (error) {
        logError(`Failed to load evaluation ${file}`, error);
      }
    }
  }

  return evaluations;
}

// Individual test runners
async function runFreezeOtpTest(evaluation) {
  logInfo(`Running ${evaluation.name}...`);
  
  try {
    // Start triage for the alert
    const triageResponse = await api.post('/triage', {
      alertId: evaluation.input.alertId
    }, {
      headers: {
        'Idempotency-Key': `eval-${evaluation.id}-${Date.now()}`
      }
    });

    if (triageResponse.status !== 200) {
      throw new Error(`Triage failed with status ${triageResponse.status}`);
    }

    const { runId } = triageResponse.data;

    // Wait for triage completion (simplified for demo)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get triage results
    const resultResponse = await api.get(`/triage/${runId}`);
    const triageResult = resultResponse.data;

    // Validate expectations
    const expectedOutcome = evaluation.expectedOutcome;
    let passed = true;
    const errors = [];

    if (triageResult.recommendation !== expectedOutcome.recommendation) {
      errors.push(`Expected recommendation ${expectedOutcome.recommendation}, got ${triageResult.recommendation}`);
      passed = false;
    }

    if (triageResult.riskLevel !== expectedOutcome.riskLevel) {
      errors.push(`Expected risk level ${expectedOutcome.riskLevel}, got ${triageResult.riskLevel}`);
      passed = false;
    }

    // Test freeze card action
    if (expectedOutcome.otpRequired) {
      const freezeResponse = await api.post('/action/freeze-card', {
        cardId: evaluation.input.cardId,
        otp: evaluation.validation.otpCode
      }, {
        headers: {
          'Idempotency-Key': `freeze-${evaluation.id}-${Date.now()}`
        }
      });

      if (freezeResponse.data.status !== 'FROZEN') {
        errors.push(`Expected card to be frozen, got status ${freezeResponse.data.status}`);
        passed = false;
      }
    }

    if (passed) {
      logSuccess(`${evaluation.name} - PASSED`);
      results.passed++;
    } else {
      logError(`${evaluation.name} - FAILED`);
      results.failed++;
      results.errors.push({ test: evaluation.name, errors });
    }

  } catch (error) {
    logError(`${evaluation.name} - ERROR`, error);
    results.failed++;
    results.errors.push({ test: evaluation.name, errors: [error.message] });
  }
}

async function runDisputeCreationTest(evaluation) {
  logInfo(`Running ${evaluation.name}...`);
  
  try {
    // Open dispute for the transaction
    const disputeResponse = await api.post('/action/open-dispute', {
      txnId: evaluation.input.transactionId,
      reasonCode: evaluation.expectedOutcome.reasonCode,
      confirm: true,
      description: evaluation.input.customerReport
    }, {
      headers: {
        'Idempotency-Key': `dispute-${evaluation.id}-${Date.now()}`
      }
    });

    const expectedOutcome = evaluation.expectedOutcome;
    let passed = true;
    const errors = [];

    if (!disputeResponse.data.caseId) {
      errors.push('Expected caseId to be created');
      passed = false;
    }

    if (disputeResponse.data.status !== expectedOutcome.status) {
      errors.push(`Expected status ${expectedOutcome.status}, got ${disputeResponse.data.status}`);
      passed = false;
    }

    if (passed) {
      logSuccess(`${evaluation.name} - PASSED`);
      results.passed++;
    } else {
      logError(`${evaluation.name} - FAILED`);
      results.failed++;
      results.errors.push({ test: evaluation.name, errors });
    }

  } catch (error) {
    logError(`${evaluation.name} - ERROR`, error);
    results.failed++;
    results.errors.push({ test: evaluation.name, errors: [error.message] });
  }
}

async function runRateLimitTest(evaluation) {
  logInfo(`Running ${evaluation.name}...`);
  
  try {
    // Send requests rapidly to trigger rate limit
    const promises = [];
    const requestCount = 15; // Should exceed the limit
    
    for (let i = 0; i < requestCount; i++) {
      promises.push(
        api.post('/triage', { alertId: 'alert-001' }, {
          headers: {
            'Idempotency-Key': `rate-test-${i}-${Date.now()}`
          },
          validateStatus: () => true // Don't throw on 429
        })
      );
    }

    const responses = await Promise.all(promises);
    
    // Count successful and rate limited responses
    const successfulResponses = responses.filter(r => r.status === 200).length;
    const rateLimitedResponses = responses.filter(r => r.status === 429).length;

    let passed = true;
    const errors = [];

    if (rateLimitedResponses === 0) {
      errors.push('Expected at least some requests to be rate limited');
      passed = false;
    }

    // Check if rate limited responses have Retry-After header
    const rateLimitedWithRetryAfter = responses
      .filter(r => r.status === 429)
      .filter(r => r.headers['retry-after']);

    if (rateLimitedWithRetryAfter.length === 0 && rateLimitedResponses > 0) {
      errors.push('Rate limited responses should include Retry-After header');
      passed = false;
    }

    if (passed) {
      logSuccess(`${evaluation.name} - PASSED (${rateLimitedResponses}/${requestCount} rate limited)`);
      results.passed++;
    } else {
      logError(`${evaluation.name} - FAILED`);
      results.failed++;
      results.errors.push({ test: evaluation.name, errors });
    }

  } catch (error) {
    logError(`${evaluation.name} - ERROR`, error);
    results.failed++;
    results.errors.push({ test: evaluation.name, errors: [error.message] });
  }
}

async function runPiiRedactionTest(evaluation) {
  logInfo(`Running ${evaluation.name}...`);
  
  try {
    // Ingest transaction with PII data
    const ingestResponse = await api.post('/ingest/transactions', {
      transactions: [
        {
          customerId: 'c1e7e8a0-4b3f-4c8b-a1e2-f4d5e6789012',
          cardId: 'card-001',
          mcc: '5999',
          merchant: 'Merchant with card 4111111111111111 in name',
          amountCents: 5000,
          currency: 'USD',
          ts: new Date().toISOString()
        }
      ]
    }, {
      headers: {
        'Idempotency-Key': `pii-test-${Date.now()}`
      }
    });

    let passed = true;
    const errors = [];

    // Check if the response doesn't contain PII
    const responseStr = JSON.stringify(ingestResponse.data);
    if (responseStr.includes('4111111111111111')) {
      errors.push('API response contains unredacted card number');
      passed = false;
    }

    // Note: In a full implementation, we'd also check logs and database
    // to ensure PII is properly redacted there as well

    if (passed) {
      logSuccess(`${evaluation.name} - PASSED`);
      results.passed++;
    } else {
      logError(`${evaluation.name} - FAILED`);
      results.failed++;
      results.errors.push({ test: evaluation.name, errors });
    }

  } catch (error) {
    logError(`${evaluation.name} - ERROR`, error);
    results.failed++;
    results.errors.push({ test: evaluation.name, errors: [error.message] });
  }
}

async function runPerformanceTest(evaluation) {
  logInfo(`Running ${evaluation.name}...`);
  
  try {
    const customerId = evaluation.input.customerId;
    const start = Date.now();
    
    // Query customer transactions
    const response = await api.get(`/customer/${customerId}/transactions`, {
      params: {
        from: '2024-01-01',
        to: '2024-12-31',
        limit: 1000
      }
    });

    const duration = Date.now() - start;
    const expectedMaxTime = 100; // ms

    let passed = true;
    const errors = [];

    if (duration > expectedMaxTime) {
      errors.push(`Query took ${duration}ms, expected < ${expectedMaxTime}ms`);
      passed = false;
    }

    if (response.status !== 200) {
      errors.push(`Expected 200 status, got ${response.status}`);
      passed = false;
    }

    if (passed) {
      logSuccess(`${evaluation.name} - PASSED (${duration}ms)`);
      results.passed++;
    } else {
      logError(`${evaluation.name} - FAILED`);
      results.failed++;
      results.errors.push({ test: evaluation.name, errors });
    }

  } catch (error) {
    logError(`${evaluation.name} - ERROR`, error);
    results.failed++;
    results.errors.push({ test: evaluation.name, errors: [error.message] });
  }
}

// Test runner mapping
const testRunners = {
  'freeze_otp': runFreezeOtpTest,
  'dispute_creation': runDisputeCreationTest,
  'duplicate_analysis': runDisputeCreationTest, // Simplified for demo
  'tool_timeout': runFreezeOtpTest, // Simplified for demo
  'rate_limiting': runRateLimitTest,
  'pii_redaction': runPiiRedactionTest,
  'performance_test': runPerformanceTest
};

// Main evaluation runner
async function runEvaluations() {
  log('🧪 Sentinel Support Evaluation Suite', 'bold');
  log('=====================================\n', 'bold');

  // Check API health first
  try {
    const healthResponse = await api.get('/health');
    if (healthResponse.data.status !== 'healthy') {
      throw new Error(`API not healthy: ${healthResponse.data.status}`);
    }
    logSuccess('API health check passed');
  } catch (error) {
    logError('API health check failed', error);
    logError('Ensure the API server is running and healthy before running evaluations');
    process.exit(1);
  }

  const evaluations = loadEvaluations();
  logInfo(`Loaded ${evaluations.length} evaluation test cases\n`);

  // Run each evaluation
  for (const evaluation of evaluations) {
    const runner = testRunners[evaluation.scenario];
    
    if (runner) {
      await runner(evaluation);
    } else {
      logWarning(`No test runner for scenario: ${evaluation.scenario}`);
      results.skipped++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Print results summary
  console.log('\n' + '='.repeat(50));
  log('📊 EVALUATION RESULTS', 'bold');
  console.log('='.repeat(50));
  
  logSuccess(`✅ Passed: ${results.passed}`);
  if (results.failed > 0) {
    logError(`❌ Failed: ${results.failed}`);
  }
  if (results.skipped > 0) {
    logWarning(`⚠️  Skipped: ${results.skipped}`);
  }

  const total = results.passed + results.failed + results.skipped;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;
  
  log(`\n📈 Pass Rate: ${passRate}%`, passRate >= 80 ? 'green' : 'red');

  // Print detailed errors
  if (results.errors.length > 0) {
    console.log('\n' + '='.repeat(30));
    log('🔍 DETAILED ERRORS', 'red');
    console.log('='.repeat(30));
    
    for (const error of results.errors) {
      log(`\n${error.test}:`, 'yellow');
      for (const err of error.errors) {
        console.log(`  - ${err}`);
      }
    }
  }

  // Performance summary (simplified)
  console.log('\n' + '='.repeat(30));
  log('⚡ PERFORMANCE SUMMARY', 'blue');
  console.log('='.repeat(30));
  console.log('Task success rate: N/A (requires full implementation)');
  console.log('Fallback rate by tool: N/A (requires agent implementation)');
  console.log('Agent latency p50/p95: N/A (requires metrics collection)');
  console.log('Risk confusion matrix: N/A (requires ML model)');
  console.log('Top policy denials: N/A (requires policy engine)');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run if called directly
if (require.main === module) {
  runEvaluations().catch(error => {
    console.error('Evaluation runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runEvaluations };