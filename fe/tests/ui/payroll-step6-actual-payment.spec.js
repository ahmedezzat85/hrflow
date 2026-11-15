import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Step 6 (statutory): the payment button takes the amount actually paid, which may be more or less than the recorded figure.
test.describe('Payroll step 6: pay the actual statutory amount', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-payroll');
    await page.click('#btnOpenCurrentCycle');
    await page.evaluate(() => {
      window._settled = [];
      FinanceApi.settleStatutoryObligation = async (id, payload) => { window._settled.push({ id, payload }); return { id, status: 'remitted' }; };
      FinanceApi.listStatutoryObligations = async () => [
        { id: 99, obligation_type: 'social_insurance_employee', period: PayrollApp.month, amount_accrued: 2200, amount_remitted: 0, status: 'accrued', currency: 'EGP', notes: 'payroll_run_id:1' },
        { id: 98, obligation_type: 'income_tax', period: PayrollApp.month, amount_accrued: 1000, amount_remitted: 0, status: 'accrued', currency: 'EGP', notes: 'payroll_run_id:1' },
      ];
      PayrollApp.banks = [{ id: 7, name: 'Settling Account', currency: 'EGP', number: '****9988' }];
      PayrollApp.selectedExternalAccountId = 7;
      PayrollApp.fundingSummary = { external: { id: 7, name: 'Settling Account', currency: 'EGP' }, internal: null };
      PayrollApp.setStep(5);
    });
    await expect(page.locator('#payrollScreen6')).toBeVisible();
    await expect(page.locator('#p6SiPaidAmount')).toHaveValue('2200.00');   // starts at what is still owed
  });

  test('paying more than the recorded figure is sent as typed, with no cap', async ({ page }) => {
    await page.fill('#p6SiPaymentDate', '2026-10-20');
    await page.fill('#p6SiPaidAmount', '2310.50');
    await expect(page.locator('#p6SiPaidHint')).toContainText('more than the recorded figure');
    await page.click('#btnP6SettleSocialIns');
    const sent = await page.evaluate(() => window._settled);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ amount: 2310.5, payment_date: '2026-10-20', bank_account_id: 7, final_payment: false });
  });

  test('paying less stays an instalment unless it is marked final', async ({ page }) => {
    await page.fill('#p6TaxPaymentDate', '2026-10-21');
    await page.fill('#p6TaxPaidAmount', '940');
    await expect(page.locator('#p6TaxPaidHint')).toContainText('stays outstanding');
    await page.check('#p6TaxFinal');
    await expect(page.locator('#p6TaxPaidHint')).toContainText('closes with that difference');
    await page.click('#btnP6SettleTax');
    const sent = await page.evaluate(() => window._settled);
    expect(sent[0].payload).toMatchObject({ amount: 940, final_payment: true });
  });

  test('an empty or zero amount is not sent', async ({ page }) => {
    await page.fill('#p6SiPaidAmount', '');
    await page.click('#btnP6SettleSocialIns');
    expect(await page.evaluate(() => window._settled.length)).toBe(0);
    await expect(page.locator('#p6SiPaidAmount')).toBeVisible();
  });
});
