import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// F4. Real currency enforcement and ledger posting are covered by be/tests/test_finance_statutory_rules.py.
test.describe('Statutory obligations: currency and payment type (F4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await openAdminPage(page, 'a-finance-statutory');
  });

  test('Remittance dialog offers only accounts in the obligation currency and fitting payment types', async ({ page }) => {
    const row = page.locator('#financeStatutoryTableBody tr:has-text("Withholding Tax (WHT)")');
    await expect(row).toBeVisible();
    const currency = await page.evaluate(() => window.FinanceMockState.statutoryObligations.find((o) => o.obligation_type === 'withholding_tax').currency);
    await row.locator('.btn-stat-remit').click();
    await expect(page.locator('#statutorySettleModal')).toBeVisible();

    const accounts = await page.locator('#statSettleBankAccount option').allTextContents();
    expect(accounts.length).toBeGreaterThan(0);
    for (const label of accounts) expect(label).toContain(`(${currency})`);

    await expect(page.locator('#statSettlePaymentType')).not.toHaveValue('');
    const types = (await page.locator('#statSettlePaymentType option').allTextContents()).join(' ');
    expect(types).not.toContain('Incoming');
    await page.click('#statutorySettleModal .modal-close');
  });

  test('Mock API refuses a remittance from an account of another currency', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const obl = window.FinanceMockState.statutoryObligations.find((o) => o.obligation_type === 'withholding_tax');
      const other = window.FinanceMockState.accounts.find((a) => a.currency !== obl.currency);
      try {
        await window.FinanceApi.settleStatutoryObligation(obl.id, { amount: 10, payment_date: '2026-10-01', bank_account_id: other.id });
        return 'settled';
      } catch (e) { return e.message; }
    });
    expect(msg).toContain('currency_mismatch');
  });

  test('A new obligation recorded without choosing a currency is EGP', async ({ page }) => {
    const currency = await page.evaluate(async () => (await window.FinanceApi.createStatutoryObligation({ obligation_type: 'sales_tax', period: '2026-07', amount_accrued: 100 })).currency);
    expect(currency).toBe('EGP');
  });
});
