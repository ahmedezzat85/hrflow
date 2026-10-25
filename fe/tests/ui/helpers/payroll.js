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

/** Funding accounts are owned by Payroll Settings: set a USD internal account there to match USD payroll runs. */
export async function selectUsdInternalAccount(page) {
  await page.evaluate(async () => {
    const usd = (PayrollApp.banks || []).find((b) => String(b.currency).toUpperCase() === 'USD');
    if (usd) { await PayrollApp.setFundingAccount('internal', usd.id); PayrollApp.drawScreen1(); }
  });
}
