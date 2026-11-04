import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openAdminPage } from './helpers/admin-nav.js';

// Regression: Cancel buttons shipped with onclick="closeModal(\'id\')", a JS syntax error, so they did nothing.
test('no partial has backslash-escaped quotes inside an inline handler', () => {
  const root = path.resolve('src/partials');
  const bad = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!p.endsWith('.html')) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\bon\w+="[^"]*[\x5c]'/.test(l)) bad.push(`${path.relative(root, p)}:${i + 1}`); });
  });
  walk(root);
  expect(bad).toEqual([]);
});

const CASES = [
  ['a-finance-subscriptions', 'subscriptionModal'],
  ['a-finance-subscriptions', 'subscriptionChargeModal'],
  ['a-finance-subscriptions', 'subscriptionHistoryModal'],
  ['a-finance-statutory', 'statutoryConfirmModal'],
  ['a-finance-statutory', 'statutorySettleModal'],
  ['a-finance-statutory', 'statutoryRecordModal'],
];

for (const [page_, modalId] of CASES) {
  test(`${modalId}: footer Cancel/Close button closes the dialog`, async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, page_);
    await page.evaluate((id) => openModal(id), modalId);
    const modal = page.locator(`#${modalId}`);
    await expect(modal).toBeVisible();
    await modal.locator('.modal-foot button.btn:not(.btn-fill)').first().click();
    await expect(modal).not.toBeVisible();
  });
}
