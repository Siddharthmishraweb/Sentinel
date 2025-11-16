#!/usr/bin/env node

/**
 * Transaction Data Generator
 * Generates realistic transaction data for testing and development
 * Can generate up to 1M+ records with configurable parameters
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  outputFile: path.join(__dirname, '../fixtures/transactions.json'),
  count: parseInt(process.env.TX_COUNT || '200000'), // Default 200k transactions
  startDate: new Date('2023-01-01'),
  endDate: new Date(),
  customers: [
    'c1e7e8a0-4b3f-4c8b-a1e2-f4d5e6789012',
    'd2f8f9b1-5c4g-5d9c-b2f3-g5e6f7890123',
    'e3g9g0c2-6d5h-6e0d-c3g4-h6f7g8901234',
    'f4h0h1d3-7e6i-7f1e-d4h5-i7g8h9012345',
    'g5i1i2e4-8f7j-8g2f-e5i6-j8h9i0123456'
  ],
  cards: [
    'card-001',
    'card-002', 
    'card-003',
    'card-004',
    'card-005'
  ],
  accounts: [
    'acc-001',
    'acc-002',
    'acc-003', 
    'acc-004',
    'acc-005'
  ]
};

// Merchant categories and common merchants
const merchantCategories = {
  '5411': { name: 'Grocery Stores', merchants: ['Whole Foods', 'Safeway', 'Kroger', 'Target Grocery', 'Walmart Grocery'] },
  '5812': { name: 'Restaurants', merchants: ['McDonalds', 'Starbucks', 'Chipotle', 'Subway', 'Pizza Hut'] },
  '5542': { name: 'Gas Stations', merchants: ['Shell', 'Chevron', 'Exxon', 'BP', 'Mobil'] },
  '5331': { name: 'Variety Stores', merchants: ['Target', 'Walmart', 'Costco', 'Amazon', 'Best Buy'] },
  '4121': { name: 'Taxi/Rideshare', merchants: ['Uber', 'Lyft', 'Yellow Cab', 'QuickCab', 'Metro Taxi'] },
  '5999': { name: 'Misc Retail', merchants: ['ABC Mart', 'XYZ Store', 'Corner Shop', 'Local Market', 'Convenience Plus'] },
  '5735': { name: 'Music Stores', merchants: ['Spotify', 'Apple Music', 'Amazon Music', 'Music Store', 'Vinyl Records'] },
  '5945': { name: 'Toys/Games', merchants: ['GameStop', 'Toys R Us', 'Amazon Games', 'Local Game Store', 'Board Game Cafe'] }
};

const countries = ['US', 'CA', 'GB', 'FR', 'DE', 'JP', 'AU', 'IN', 'BR', 'MX'];
const cities = ['New York', 'San Francisco', 'Chicago', 'Houston', 'Los Angeles', 'Seattle', 'Boston', 'Austin', 'Denver', 'Miami'];

// Generate device IDs
const deviceIds = Array.from({ length: 50 }, (_, i) => `device-${String(i + 1).padStart(3, '0')}`);

// Utility functions
function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateTransactionAmount(mcc) {
  const ranges = {
    '5411': [500, 15000],    // Grocery: $5-150
    '5812': [800, 8000],     // Restaurant: $8-80  
    '5542': [2000, 12000],   // Gas: $20-120
    '5331': [1500, 50000],   // Retail: $15-500
    '4121': [600, 4000],     // Rideshare: $6-40
    '5999': [300, 20000],    // Misc: $3-200
    '5735': [99, 2999],      // Music: $0.99-29.99
    '5945': [1000, 30000]    // Toys: $10-300
  };
  
  const range = ranges[mcc] || [500, 10000];
  return randomInt(range[0], range[1]);
}

function generateSuspiciousTransaction(customerId, cardId, accountId, baseTs) {
  const mccs = Object.keys(merchantCategories);
  const mcc = randomElement(mccs);
  const category = merchantCategories[mcc];
  
  // Make it suspicious
  const suspiciousFactors = [
    // Large amount
    () => ({ 
      amountCents: randomInt(50000, 200000),
      merchant: randomElement(category.merchants),
      country: 'US'
    }),
    // Foreign transaction
    () => ({
      amountCents: randomInt(1000, 10000),  
      merchant: 'Foreign Merchant XYZ',
      country: randomElement(['RU', 'NG', 'CN', 'PK'])
    }),
    // Velocity (multiple quick transactions)
    () => ({
      amountCents: randomInt(2000, 8000),
      merchant: randomElement(category.merchants),
      country: 'US',
      velocityGroup: true
    }),
    // Unusual merchant  
    () => ({
      amountCents: randomInt(5000, 25000),
      merchant: 'Unknown Online Merchant',
      country: 'US'
    })
  ];
  
  const factor = randomElement(suspiciousFactors)();
  
  return {
    id: `txn-suspicious-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    customerId,
    cardId,
    accountId,
    mcc,
    merchant: factor.merchant,
    amountCents: factor.amountCents,
    currency: 'USD',
    ts: baseTs,
    deviceId: factor.velocityGroup ? randomElement(deviceIds.slice(0, 5)) : randomElement(deviceIds),
    country: factor.country,
    city: factor.country === 'US' ? randomElement(cities) : 'Foreign City',
    authCode: Math.random().toString(36).substr(2, 6).toUpperCase(),
    referenceId: `REF${Date.now()}${randomInt(100, 999)}`,
    status: 'COMPLETED'
  };
}

function generateNormalTransaction(customerId, cardId, accountId) {
  const mccs = Object.keys(merchantCategories);
  const mcc = randomElement(mccs);
  const category = merchantCategories[mcc];
  const merchant = randomElement(category.merchants);
  
  return {
    id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    customerId,
    cardId, 
    accountId,
    mcc,
    merchant,
    amountCents: generateTransactionAmount(mcc),
    currency: 'USD',
    ts: randomDate(config.startDate, config.endDate),
    deviceId: randomElement(deviceIds),
    country: Math.random() < 0.95 ? 'US' : randomElement(countries),
    city: Math.random() < 0.95 ? randomElement(cities) : 'Other City',
    authCode: Math.random().toString(36).substr(2, 6).toUpperCase(),
    referenceId: `REF${Date.now()}${randomInt(100, 999)}`, 
    status: Math.random() < 0.98 ? 'COMPLETED' : (Math.random() < 0.5 ? 'PENDING' : 'FAILED')
  };
}

function generateTransactions() {
  console.log(`Generating ${config.count} transactions...`);
  const transactions = [];
  const batchSize = 10000;
  
  // Add some specific suspicious transactions for testing
  const suspiciousTransactions = [
    {
      id: 'txn-suspicious-001',
      customerId: 'f4h0h1d3-7e6i-7f1e-d4h5-i7g8h9012345',
      cardId: 'card-004',
      accountId: 'acc-004', 
      mcc: '5999',
      merchant: 'ABC Mart',
      amountCents: 499900, // $4,999 - mentioned in acceptance test
      currency: 'INR',
      ts: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      deviceId: 'device-unknown-001',
      country: 'IN',
      city: 'Mumbai',
      authCode: 'AUTH01',
      referenceId: 'REF202411150001',
      status: 'COMPLETED'
    },
    {
      id: 'txn-suspicious-002', 
      customerId: 'd2f8f9b1-5c4g-5d9c-b2f3-g5e6f7890123',
      cardId: 'card-002',
      accountId: 'acc-002',
      mcc: '4121', 
      merchant: 'QuickCab',
      amountCents: 2500,
      currency: 'USD',
      ts: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      deviceId: 'device-002',
      country: 'US',
      city: 'San Francisco', 
      authCode: 'AUTH02',
      referenceId: 'REF202411150002',
      status: 'COMPLETED'
    },
    // Duplicate transaction for testing
    {
      id: 'txn-duplicate-001',
      customerId: 'd2f8f9b1-5c4g-5d9c-b2f3-g5e6f7890123',
      cardId: 'card-002', 
      accountId: 'acc-002',
      mcc: '4121',
      merchant: 'QuickCab',
      amountCents: 2500,
      currency: 'USD',
      ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000), // 30 seconds after first
      deviceId: 'device-002', 
      country: 'US',
      city: 'San Francisco',
      authCode: 'AUTH03',
      referenceId: 'REF202411150003',
      status: 'PENDING' // Preauth vs capture
    }
  ];
  
  transactions.push(...suspiciousTransactions);
  
  // Generate normal transactions
  let generated = suspiciousTransactions.length;
  while (generated < config.count) {
    const batch = [];
    const remaining = Math.min(batchSize, config.count - generated);
    
    for (let i = 0; i < remaining; i++) {
      const customerIndex = Math.floor(Math.random() * config.customers.length);
      const customerId = config.customers[customerIndex];
      const cardId = config.cards[customerIndex];
      const accountId = config.accounts[customerIndex];
      
      // 5% chance of suspicious transaction
      if (Math.random() < 0.05) {
        const suspiciousTx = generateSuspiciousTransaction(
          customerId, 
          cardId, 
          accountId, 
          randomDate(config.startDate, config.endDate)
        );
        batch.push(suspiciousTx);
      } else {
        batch.push(generateNormalTransaction(customerId, cardId, accountId));
      }
    }
    
    transactions.push(...batch);
    generated += batch.length;
    
    if (generated % 50000 === 0) {
      console.log(`Generated ${generated} transactions...`);
    }
  }
  
  // Sort by timestamp for realistic ordering
  transactions.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  
  console.log(`Writing ${transactions.length} transactions to ${config.outputFile}`);
  fs.writeFileSync(config.outputFile, JSON.stringify(transactions, null, 2));
  console.log('Transaction generation complete!');
  
  // Generate summary stats (fix for large arrays)
  const dates = transactions.map(t => new Date(t.ts));
  const minDate = dates.reduce((min, current) => current < min ? current : min);
  const maxDate = dates.reduce((max, current) => current > max ? current : max);
  
  const stats = {
    total: transactions.length,
    dateRange: {
      start: minDate,
      end: maxDate
    },
    customerDistribution: config.customers.reduce((acc, customerId) => {
      acc[customerId] = transactions.filter(t => t.customerId === customerId).length;
      return acc;
    }, {}),
    merchantCategories: Object.keys(merchantCategories).reduce((acc, mcc) => {
      acc[mcc] = transactions.filter(t => t.mcc === mcc).length;
      return acc;
    }, {}),
    statusDistribution: transactions.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {}),
    totalAmountCents: transactions.reduce((sum, t) => sum + t.amountCents, 0)
  };
  
  console.log('\nGeneration Summary:');
  console.log(`Total transactions: ${stats.total}`);
  console.log(`Date range: ${new Date(stats.dateRange.start).toISOString()} to ${new Date(stats.dateRange.end).toISOString()}`);
  console.log(`Total amount: $${(stats.totalAmountCents / 100).toLocaleString()}`);
  console.log('Status distribution:', stats.statusDistribution);
  
  return transactions;
}

// Run if called directly
if (require.main === module) {
  generateTransactions();
}

module.exports = { generateTransactions, config };