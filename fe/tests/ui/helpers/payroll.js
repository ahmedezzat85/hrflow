import { expect } from '@playwright/test';
import { confirmDialog } from './confirm.js';

/**
 * Screen 2 has two visible steps: "Submit for approval", then "Approve".
 * @param {import('@playwright/test').Page} page
 */
export async function submitAndApprove(page) {
  const btn = page.locator('#btnP2Approve');
  await expect(btn).toContainText('Submit for approval');
  await btn.click();
  await expect(btn).toContainText('Approve', { timeout: 5000 });
  await expect(btn).not.toContainText('Submit');
  await btn.click();
}

/** Screen 5: the payment is recorded only after the confirmation dialog is accepted. */
export async function confirmPayment(page) {
  await page.click('#btnP5ConfirmDisburse');
  await confirmDialog(page);
}

/** Screen 1: select a USD internal funding account to match USD payroll runs when disbursement is tested. */
export async function selectUsdInternalAccount(page) {
  const intSelect = page.locator('#p1IntAccount');
  const intUsd = intSelect.locator('option:has-text("USD")').first();
  if (await intUsd.count() > 0) {
    const val = await intUsd.getAttribute('value');
    if (val) await intSelect.selectOption(val);
  }
}
