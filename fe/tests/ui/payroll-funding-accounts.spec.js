import { test, expect } from '@playwright/test';
import { submitAndApprove } from './helpers/payroll.js';
import { openAdminPage } from './helpers/admin-nav.js';

// Funding accounts are owned by Payroll Settings: runs read them, payment stops until they are set.

async function openPayroll(page, mock = 'admin', { unset = false } = {}) {
  await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-finance-payroll');
  if (unset) {
    await page.evaluate(() => {
      FinanceMockState.payrollSettings = { id: 1, employee_rate: 0.11, employer_rate: 0.18, external_funding_account_id: null, internal_funding_account_id: null };
      return PayrollApp.loadSettingsFromDb();
    });
  }
}

test.describe('Payroll funding accounts in Payroll settings', () => {
  test('set-up step shows the Settings accounts read-only', async ({ page }) => {
    await openPayroll(page);
    await page.click('#btnOpenCurrentCycle');
    await expect(page.locator('#p1ExtAccount')).toBeDisabled();
    await expect(page.locator('#p1IntAccount')).toBeDisabled();
    await expect(page.locator('#p1FundingNotice')).toBeHidden();
    await expect(page.locator('#p1ExtAccount option:checked')).not.toHaveText('Not set');
  });

  test('unset accounts: notice on set-up, run payload carries no funding ids, nothing in localStorage', async ({ page }) => {
    await openPayroll(page, 'admin', { unset: true });
    await page.click('#btnOpenCurrentCycle');
    await expect(page.locator('#p1FundingNotice')).toBeVisible();
    await expect(page.locator('#p1FundingNotice')).toContainText('Payment is blocked until they are set in Payroll settings');
    await expect(page.locator('#p1ExtAccount option:checked')).toHaveText('Not set');
    await page.evaluate(() => {
      window.__posted = [];
      const orig = FinanceApi.createPayrollRun.bind(FinanceApi);
      FinanceApi.createPayrollRun = (p) => { window.__posted.push(p); return orig(p); };
    });
    await page.click('#btnP1Proceed');
    await submitAndApprove(page);
    const posted = await page.evaluate(() => window.__posted);
    expect(posted.length).toBeGreaterThan(0);
    for (const p of posted) {
      for (const k of ['bank_account_id', 'external_funding_account_id', 'internal_funding_account_id']) expect(p).not.toHaveProperty(k);
    }
    expect(await page.evaluate(() => localStorage.getItem('hrflow_payroll_funding_accounts'))).toBeNull();
  });

  test('payment is blocked until the accounts are saved at the Pay step, then it can be recorded', async ({ page }) => {
    await openPayroll(page, 'admin', { unset: true });
    await page.click('#btnOpenCurrentCycle');
    await page.click('#btnP1Proceed');
    await submitAndApprove(page);
    await page.click('#btnP3Next');
    await page.click('#btnP4Next');
    await expect(page.locator('#payrollScreen5')).toBeVisible();
    await expect(page.locator('#p5FundingBlock')).toBeVisible();
    await expect(page.locator('#btnP5ConfirmDisburse')).toBeDisabled();
    await expect(page.locator('#p5ConfirmHint')).toContainText('blocked until the funding accounts are set');

    const ext = page.locator('#p5FundExt');
    const int = page.locator('#p5FundInt');
    await ext.selectOption({ index: 1 });
    await int.selectOption({ index: 1 });
    await page.click('#p5SaveFundingBtn');
    await expect(page.locator('#p5FundingBlock')).toBeHidden();
    await expect(page.locator('#btnP5ConfirmDisburse')).toBeEnabled();
    const saved = await page.evaluate(() => FinanceMockState.payrollSettings);
    expect(saved.external_funding_account_id).toBeTruthy();
    expect(saved.internal_funding_account_id).toBeTruthy();
  });

  test('Settings page: Financial-Admin can replace an account, Payroll-Maker cannot', async ({ page }) => {
    await openPayroll(page, 'finance');
    expect(await page.evaluate(() => PayrollApp.canSetFundingAccounts())).toBe(true);
    await page.evaluate(() => PayrollApp.showPage('settings'));
    const ext = page.locator('#payrollTargetExternalAccount');
    await expect(ext).toBeEnabled();
    const options = await ext.locator('option').evaluateAll((os) => os.map((o) => o.value));
    await ext.selectOption(options[options.length - 1]);
    await expect(page.locator('#payrollFundingNote')).toContainText('Runs use these accounts');
    const saved = await page.evaluate(() => FinanceMockState.payrollSettings.external_funding_account_id);
    expect(String(saved)).toBe(String(options[options.length - 1]));

    await openPayroll(page, 'payroll');
    expect(await page.evaluate(() => PayrollApp.canSetFundingAccounts())).toBe(false);
  });
});
