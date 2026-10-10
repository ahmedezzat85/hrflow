import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// F2 (D-023). Real totals, revenue and persistence are covered by be/tests/test_finance_invoice_vat.py.
test.describe('VAT on sales invoices (F2)', () => {
  test('New EGP invoice defaults to 14% VAT and shows net, VAT and total; USD defaults to 0%', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    await expect(page.locator('#invoiceVatRate')).toHaveValue('0');
    await page.selectOption('#invoiceCurrency', 'EGP');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('14');

    const line = page.locator('#invoiceLinesBody tr').first();
    await line.locator("input[type='text']").fill('Consulting');
    await line.locator('.inv-qty').fill('1');
    await line.locator('.inv-price').fill('105000');
    await expect(page.locator('#invoiceSubtotalDisplay')).toHaveText('105000.00');
    await expect(page.locator('#invoiceVatDisplay')).toHaveText('14700.00');
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('119700.00');

    await page.selectOption('#invoiceCurrency', 'USD');
    await expect(page.locator('#invoiceVatRate')).toHaveValue('0');
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('105000.00');
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
  });

  test('VAT rate is locked on a sent invoice and editable on a draft', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    await page.locator('#financeInvoicesTableBody tr:has-text("INV-2026-001") button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceVatRate')).toBeDisabled();
    await page.click('#invoiceModal .modal-close');
    await page.locator('#financeInvoicesTableBody tr:has-text("INV-2026-002") button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceVatRate')).toBeEnabled();
    await page.click('#invoiceModal .modal-close');
  });

  test('Generate VAT estimate twice for a month updates one sales tax obligation', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // an issued EGP invoice with VAT in 2026-08
    await page.evaluate(async () => {
      const inv = await window.FinanceApi.createInvoice({
        customer_id: 1, invoice_number: 'INV-VAT-001', issue_date: '2025-11-10', due_date: '2025-11-30', currency: 'EGP',
        lines: [{ description: 'Service', quantity: 1, unit_price: 100000, line_total: 100000 }],
      });
      await window.FinanceApi.sendInvoice(inv.id);
    });
    await openAdminPage(page, 'a-finance-statutory');
    await expect(page.locator('#financeGenerateVatEstimateBtn')).toBeVisible();
    await page.fill('#financeVatEstimateMonth', '2025-11');
    await page.click('#financeGenerateVatEstimateBtn');
    await expect(page.locator('#toastWrap')).toContainText('VAT estimate');
    const count = async () => page.evaluate(() => window.FinanceMockState.statutoryObligations.filter((o) => o.obligation_type === 'sales_tax' && o.period === '2025-11' && o.source_type === 'invoice_tax_line').length);
    expect(await count()).toBe(1);
    await page.click('#financeGenerateVatEstimateBtn');
    await page.waitForTimeout(300);
    expect(await count()).toBe(1);
    const est = await page.evaluate(() => window.FinanceMockState.statutoryObligations.find((o) => o.period === '2025-11' && o.source_type === 'invoice_tax_line').amount_estimated);
    expect(est).toBe(14000);
  });
});
