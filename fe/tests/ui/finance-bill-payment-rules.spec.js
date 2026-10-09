import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Vendor Bill Workflow v2 (B3) — payment fields, currency and balance rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('Pay dialog offers only accounts in the bill currency and the payment types for the account type', async ({ page }) => {
    // BILL-2026-001 is a USD bill: only USD bank accounts are offered
    await page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001") button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentModal')).toBeVisible();
    const accountLabels = await page.locator('#billPaymentBankAccountId option').allTextContents();
    expect(accountLabels.join(' ')).toContain('USD');
    expect(accountLabels.join(' ')).not.toContain('EGP');

    // Bank account: Outgoing transfer (default), Cheque, Debit card
    await expect(page.locator('#billPaymentTypeId')).not.toHaveValue('');
    const bankTypes = await page.locator('#billPaymentTypeId option').allTextContents();
    expect(bankTypes.length).toBe(3);
    expect(bankTypes.join(' ')).toContain('Outgoing');
    expect(bankTypes.join(' ')).not.toContain('Cash');

    // Cheque reveals the cheque number field, which is required
    await page.selectOption('#billPaymentTypeId', { label: 'Check Payment' });
    await expect(page.locator('#billPaymentChequeGroup')).toBeVisible();
    await page.fill('#billPaymentAmount', '100');
    await page.click('#billPaymentSubmitBtn');
    await expect(page.locator('#billPaymentModal')).toBeVisible(); // refused: cheque number missing
    await page.fill('#billPaymentChequeNumber', '445566');
    await page.click('#billPaymentSubmitBtn');
    await expect(page.locator('#billPaymentModal')).not.toBeVisible();
  });

  test('A payment above the account balance is refused and the dialog stays open', async ({ page }) => {
    await page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001") button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentTypeId')).not.toHaveValue('');
    // Drain the selected account in the mock so the balance is below the bill
    await page.evaluate(() => {
      const id = parseInt(document.getElementById('billPaymentBankAccountId').value, 10);
      FinanceMockState.accounts.find((a) => a.id === id).current_balance = 50;
    });
    await page.fill('#billPaymentAmount', '100');
    await page.click('#billPaymentSubmitBtn');
    await expect(page.locator('#billPaymentModal')).toBeVisible();
    const bill = await page.evaluate(() => FinanceMockState.bills.find((b) => b.bill_number === 'BILL-2026-001'));
    expect(bill.amount_paid).toBe(0);
  });

  test('A cash account pays with Cash payment only', async ({ page }) => {
    await page.evaluate(async () => {
      await FinanceApi.createBill({
        vendor_id: 1, bill_number: 'BILL-EGP-CASH-1', issue_date: '2026-09-01', due_date: '2026-12-01', currency: 'EGP', category_id: 8,
        lines: [{ description: 'Office supplies', quantity: 1, unit_price: 500, line_total: 500 }],
      });
      await loadFinanceBills();
    });
    await page.locator('#financeBillsTableBody tr:has-text("BILL-EGP-CASH-1") button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentModal')).toBeVisible();
    // The cash account in the bill currency is the default
    await expect(page.locator('#billPaymentBankAccountId option:checked')).toContainText('Petty Cash');
    await expect(page.locator('#billPaymentTypeId option')).toHaveCount(1);
    await expect(page.locator('#billPaymentTypeId option')).toContainText('Cash');
    await page.click('#billPaymentModal .modal-close');
  });
});
