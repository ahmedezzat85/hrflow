import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// D-060. The real sync (amounts, quarter end, void, confirmed rows) is covered by be/tests/test_vat_statutory_sync.py;
// mock mode reproduces it so the form and the tracker can be checked deterministically.
async function openNewInvoice(page) {
  await page.goto('/?mock=admin');
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-finance-invoices');
  await page.click('#financeNewInvoiceBtn');
  await expect(page.locator('#invoiceModal')).toBeVisible();
}

async function closeInvoice(page) {
  await page.click('#invoiceModal .modal-close');
  await expect(page.locator('#invoiceModal')).not.toBeVisible();
}

test.describe('Invoice VAT default and statutory obligation (D-060)', () => {
  test('a rate typed by the user survives a currency change; other currencies stay 0', async ({ page }) => {
    await openNewInvoice(page);
    await page.selectOption('#invoiceCurrency', 'EGP');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('14');

    await page.fill('#invoiceVatRate', '5');
    await page.selectOption('#invoiceCurrency', 'USD');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('5');
    await page.selectOption('#invoiceCurrency', 'EGP');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('5');
    await closeInvoice(page);

    // reopening starts clean: USD is 0, EGP is 14 again
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('0');
    await page.selectOption('#invoiceCurrency', 'EGP');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('14');
    await closeInvoice(page);
  });

  test('choosing a customer whose default currency is EGP fills EGP and 14%', async ({ page }) => {
    await openNewInvoice(page);
    await page.evaluate(() => {
      const c = window.FinanceMockState.customers.find((x) => x.id === 5);
      c.default_currency = 'EGP';
    });
    await closeInvoice(page);
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();
    await expect(page.locator('#invoiceCustomerId option[value="5"]')).toBeAttached();
    await page.selectOption('#invoiceCustomerId', '5');
    await expect(page.locator('#invoiceCurrency')).toHaveValue('EGP');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('14');

    // a currency the user chose is not replaced by the next customer's default
    await page.selectOption('#invoiceCurrency', 'USD');
    await page.selectOption('#invoiceCustomerId', '1');
    await expect(page.locator('#invoiceCurrency')).toHaveValue('USD');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('0');
    await closeInvoice(page);
  });

  test('issuing an EGP invoice puts its VAT in the tracker due at quarter end; voiding takes it out', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const inv = await window.FinanceApi.createInvoice({
        customer_id: 1, invoice_number: 'INV-VAT-Q1', issue_date: '2026-05-10', due_date: '2026-05-30', currency: 'EGP',
        lines: [{ description: 'Service', quantity: 1, unit_price: 100000, line_total: 100000 }],
      });
      const find = () => window.FinanceMockState.statutoryObligations.filter((o) => o.obligation_type === 'sales_tax' && o.period === '2026-05' && o.currency === 'EGP');
      const beforeSend = find().length;
      await window.FinanceApi.sendInvoice(inv.id);
      const row = find()[0];
      const afterSend = { amount: row.amount_accrued, due: row.due_date, status: row.status };
      await window.FinanceApi.voidInvoice(inv.id, 'test');
      return { beforeSend, afterSend, afterVoid: find().length };
    });
    expect(result.beforeSend).toBe(0);
    expect(result.afterSend).toEqual({ amount: 14000, due: '2026-06-30', status: 'estimated' });
    expect(result.afterVoid).toBe(0);
  });

  test('an issued invoice shows as a sales tax row in the Statutory tab', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate(async () => {
      const inv = await window.FinanceApi.createInvoice({
        customer_id: 1, invoice_number: 'INV-VAT-Q2', issue_date: '2026-02-10', due_date: '2026-02-28', currency: 'EGP',
        lines: [{ description: 'Service', quantity: 1, unit_price: 200000, line_total: 200000 }],
      });
      await window.FinanceApi.sendInvoice(inv.id);
    });
    await openAdminPage(page, 'a-finance-statutory');
    const row = page.locator('#financeStatutoryTableBody tr:has-text("28,000")');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Sales Tax');
    await expect(row).toContainText('31');
  });
});
