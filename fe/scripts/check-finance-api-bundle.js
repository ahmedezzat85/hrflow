// Fails if fe/finance-api.js differs from what fe/api/finance/*.js assemble to.
// The bundle is generated on every build, so edits made only to the bundle are lost.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { assembleFinanceApi } from './assemble-finance-api.js';

const feDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const committed = readFileSync(resolve(feDir, 'finance-api.js'), 'utf-8');
if (committed !== assembleFinanceApi()) {
  console.error('fe/finance-api.js is out of sync with fe/api/finance/*.js.');
  console.error('Edit the module files, then run: npm run bundle:finance-api');
  process.exit(1);
}
console.log('finance-api bundle is in sync with its sources.');
