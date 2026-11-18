import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Withholding tax on a vendor bill (D-024 amendment): a typed amount, off by default; one payment of
// total - withholding settles the bill. Real settlement and persistence are covered by
// be/tests/test_finance_bill_withholding.py.
test.describe('Bill withholding tax', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await page.click('#tabBillQueueAll');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('Off by default; ticking shows an empty amount field and the net payable', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();
    await expect(page.locator('#billWhtApplies')).not.toBeChecked();
    await expect(page.locator('#billWhtField')).toBeHidden();

    await page.selectOption('#billCurrency', 'EGP');
    await page.fill('#billAmount', '114000');
    await page.check('#billWhtApplies');
    await expect(page.locator('#billWhtField')).toBeVisible();
    await expect(page.locator('#billWhtAmount')).toHaveValue('');

    await page.fill('#billWhtAmount', '3000');
    await expect(page.locator('#billWhtHint')).toContainText('111,000.00');

    await page.fill('#billWhtAmount', '200000');
    await expect(page.locator('#billWhtHint')).toContainText('cannot exceed');

    await page.uncheck('#billWhtApplies');
    await expect(page.locator('#billWhtField')).toBeHidden();
    await expect(page.locator('#billWhtAmount')).toHaveValue('');
    await page.click('#billModal .modal-close');
  });

  test('Already paid defaults the cash to the net payable', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await page.selectOption('#billCurrency', 'EGP');
    await page.fill('#billAmount', '114000');
    await page.check('#billWhtApplies');
    await page.fill('#billWhtAmount', '3000');
    await page.check('#billPaidChoiceYes');
    await expect(page.locator('#billPaidNowAmount')).toHaveValue('111000.00');
    await page.click('#billModal .modal-close');
  });

  test('Pay dialog offers the net payable; the full total is refused; the net settles the bill', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const bill = await FinanceApi.createBill({
        vendor_id: 1, bill_number: 'BILL-WHT-1', issue_date: '2026-09-01', due_date: '2026-12-01', currency: 'EGP',
        category_id: 8, withholding_amount: 3000,
        lines: [{ description: 'Consulting', quantity: 1, unit_price: 114000, line_total: 114000 }],
      });
      await loadFinanceBills();
      FinanceMockState.accounts.filter((a) => a.currency === 'EGP').forEach((a) => { a.current_balance = 500000; });
      return bill.id;
    });
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-WHT-1")');
    await row.locator('button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentModal')).toBeVisible();
    await expect(page.locator('#billPaymentAmount')).toHaveValue('111000.00');

    await page.fill('#billPaymentAmount', '114000');
    await page.click('#billPaymentSubmitBtn');
    await expect(page.locator('#billPaymentModal')).toBeVisible(); // refused
    let state = await page.evaluate((bid) => FinanceMockState.bills.find((b) => b.id === bid), id);
    expect(state.amount_paid).toBe(0);

    await page.fill('#billPaymentAmount', '111000');
    await page.click('#billPaymentSubmitBtn');
    await expect(page.locator('#billPaymentModal')).not.toBeVisible();
    state = await page.evaluate((bid) => FinanceMockState.bills.find((b) => b.id === bid), id);
    expect(state.status).toBe('paid');
    expect(state.amount_paid).toBe(114000); // settled: cash plus withheld
    const pay = await page.evaluate((bid) => FinanceMockState.billPayments.find((p) => p.related_bill_id === bid), id);
    expect(pay.amount).toBe(111000);
    expect(pay.withheld_amount).toBe(3000);
  });
});
