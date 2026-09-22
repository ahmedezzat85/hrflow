import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const feDir = resolve(__dirname, '..');
const financeDir = resolve(feDir, 'api/finance');

export const FINANCE_API_ORDER = [
  'core.js',
  'invoices-api.js',
  'bills-api.js',
  'accounts-api.js',
  'cheques-api.js',
  'subscriptions-api.js',
  'statements-api.js',
  'reports-api.js',
  'dashboard-api.js',
  'payroll-api.js',
  'statutory-api.js',
];

export function assembleFinanceApi() {
  const header = [
    '/**',
    ' * fe/finance-api.js',
    ' *',
    ' * Aggregated Finance API client bundled from domain modules in fe/api/finance/:',
    ...FINANCE_API_ORDER.map((f) => ` *   - fe/api/finance/${f}`),
    ' *',
    ' * DO NOT EDIT THIS BUNDLED FILE DIRECTLY.',
    ' * Make changes inside the corresponding domain file in fe/api/finance/.',
    ' */',
    '',
  ].join('\n');

  const chunks = FINANCE_API_ORDER.map((file) => {
    return readFileSync(resolve(financeDir, file), 'utf-8');
  });

  return header + '\n' + chunks.join('\n\n');
}

export function writeFinanceApiBundle() {
  const code = assembleFinanceApi();
  const targetPath = resolve(feDir, 'finance-api.js');
  writeFileSync(targetPath, code, 'utf-8');
  return targetPath;
}

if (process.argv[1] && process.argv[1].endsWith('assemble-finance-api.js')) {
  const target = writeFinanceApiBundle();
  console.log(`[assemble-finance-api] Successfully bundled ${target}`);
}
