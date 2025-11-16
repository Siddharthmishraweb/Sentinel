#!/usr/bin/env ts-node
/**
 * Synthetic transactions fixture generator
 * Usage: ts-node generate-fixtures.ts --count 500000 --customers 1000 --out fixtures/transactions-extra.json
 */
import fs from 'fs';
import path from 'path';
import { argv } from 'process';

interface Options {
  count: number;
  customers: number;
  out: string;
}

function parseArgs(): Options {
  const args = argv.slice(2);
  const opts: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const value = args[i + 1];
      opts[key] = value;
      i++;
    }
  }
  return {
    count: parseInt(opts.count || '10000', 10),
    customers: parseInt(opts.customers || '100', 10),
    out: opts.out || 'fixtures/transactions-generated.json'
  };
}

const MERCHANTS = ['Amazon', 'Uber', 'Starbucks', 'Walmart', 'Apple Store', 'Netflix', 'Airbnb', 'Adidas', 'BestBuy', 'Costco'];
const MCCS = ['5411', '5812', '5732', '7995', '4111', '4789', '5691', '5941'];
const COUNTRIES = ['US', 'CA', 'GB', 'DE', 'FR', 'IN', 'SG', 'AU'];

function randomChoice<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateTransaction(i: number, customerCount: number) {
  const customerIndex = randomInt(1, customerCount);
  return {
    id: `gen-txn-${i.toString(36)}`,
    customer_id: `gen-customer-${customerIndex.toString(36)}`,
    card_id: null,
    account_id: null,
    mcc: randomChoice(MCCS),
    merchant: randomChoice(MERCHANTS),
    amount_cents: randomInt(100, 50000),
    currency: 'USD',
    ts: new Date(Date.now() - randomInt(0, 1000 * 60 * 60 * 24 * 30)).toISOString(),
    device_id: `device-${randomInt(1, 5000)}`,
    country: randomChoice(COUNTRIES),
    city: 'City'+randomInt(1,1000),
    auth_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
    reference_id: `ref-${Math.random().toString(36).substring(2,10)}`,
    status: 'COMPLETED',
    metadata: {}
  };
}

function main() {
  const opts = parseArgs();
  const outPath = path.resolve(process.cwd(), opts.out);
  console.log(`Generating ${opts.count} synthetic transactions to ${outPath}`);

  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  stream.write('[\n');

  for (let i = 0; i < opts.count; i++) {
    const txn = generateTransaction(i, opts.customers);
    stream.write(JSON.stringify(txn));
    if (i < opts.count - 1) stream.write(',\n');
    if (i % 10000 === 0) process.stdout.write(`...${i}\n`);
  }

  stream.write('\n]');
  stream.end();
  stream.on('finish', () => console.log('Generation complete.'));
}

if (require.main === module) {
  main();
}
