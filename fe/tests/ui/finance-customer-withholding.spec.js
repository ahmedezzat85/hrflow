import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// F3 (D-024). Real settlement, bank balances and the report query are covered by
// be/tests/test_finance_customer_withholding.py.
test.describe('Customer withholding tax (F3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('With a 0 rate the receipt dialog and invoice form show no withholding fields', async ({ page }) => {
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    await page.locator('#financeInvoicesTableBody tr:has-text("INV-2026-001") button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    await expect(page.locator('#paymentWithheldField')).toBeHidden();
    await page.click('#invoicePaymentModal .modal-close');

    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceWhtField')).toBeHidden();
    await expect(page.locator('#invoiceExpectedWrap')).toBeHidden();
    await page.click('#invoiceModal .modal-close');
  });

  test('1% withholding: invoice shows expected to receive, receipt plus withheld closes it, report lists the credit', async ({ page }) => {
    // customer with a default 1% withholding and a sent 100,000 USD invoice
    await page.evaluate(async () => {
      const cust = await window.FinanceApi.createCustomer({ name: 'Withholding Co', withholding_tax_rate: 1 });
      const inv = await window.FinanceApi.createInvoice({
        customer_id: cust.id, invoice_number: 'INV-WHT-001', issue_date: '2026-09-01', due_date: '2026-12-31', currency: 'USD',
        lines: [{ description: 'Service', quantity: 1, unit_price: 100000, line_total: 100000 }],
      });
      await window.FinanceApi.sendInvoice(inv.id);
    });

    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    const row = page.locator('#financeInvoicesTableBody tr:has-text("INV-WHT-001")');
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    await expect(page.locator('#paymentWithheldField')).toBeVisible();
    await expect(page.locator('#paymentWithheldAmount')).toHaveValue('1000.00');
    await expect(page.locator('#paymentAmount')).toHaveValue('99000.00');
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.fill('#paymentReference', 'WHT-UI-1');
    await page.click('#invoicePaymentSubmitBtn');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();

    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    await expect(page.locator('#financeInvoicesTableBody tr:has-text("INV-WHT-001")')).toContainText('Paid');

    const state = await page.evaluate(() => {
      const inv = window.FinanceMockState.invoices.find((i) => i.invoice_number === 'INV-WHT-001');
      return { expected: inv.expected_to_receive, withheld: inv.withheld_total, cash: inv.amount_paid, balance: inv.balance };
    });
    expect(state).toEqual({ expected: 99000, withheld: 1000, cash: 99000, balance: 0 });

    await openAdminPage(page, 'a-finance-reports');
    await page.evaluate(() => window.openReportFromLibrary('withholding-credits'));
    await expect(page.locator('#reportPaneWithholdingCredits')).toBeVisible();
    await expect(page.locator('#reportWhtTableBody')).toContainText('Withholding Co');
    await expect(page.locator('#reportWhtTableBody')).toContainText('1,000.00');
  });

  test('Mock API refuses withheld tax above the expected withholding', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const inv = (await window.FinanceApi.getInvoices({ status: 'all' })).find((i) => i.invoice_number === 'INV-2026-001');
      try {
        await window.FinanceApi.recordInvoicePayment(inv.id, { direction: 'incoming', amount: 900, withheld_amount: 100, currency: 'USD', payment_date: '2026-09-10', bank_account_id: 1, reference: 'F3-X' });
        return 'recorded';
      } catch (e) { return e.message; }
    });
    expect(msg).toContain('withheld_exceeds_expected');
  });
});
