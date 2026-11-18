import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Withholding tax on the invoice form: off unless ticked, 3% when ticked (D-024).
// Persistence and settlement are covered by be/tests/test_finance_customer_withholding.py.
test.describe('Invoice withholding tax toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();
  });

  test('Off by default; ticking applies 3% on the net subtotal and shows expected to receive', async ({ page }) => {
    await expect(page.locator('#invoiceWhtApplies')).not.toBeChecked();
    await expect(page.locator('#invoiceWhtField')).toBeHidden();

    await page.selectOption('#invoiceCurrency', 'EGP'); // 14% VAT
    const line = page.locator('#invoiceLinesBody tr').first();
    await line.locator("input[type='text']").fill('Consulting');
    await line.locator('.inv-qty').fill('1');
    await line.locator('.inv-price').fill('100000');
    await expect(page.locator('#invoiceExpectedWrap')).toBeHidden();

    await page.check('#invoiceWhtApplies');
    await expect(page.locator('#invoiceWhtField')).toBeVisible();
    await expect(page.locator('#invoiceWhtRate')).toHaveValue('3');
    // 100000 + 14000 VAT - 3% of the 100000 net subtotal
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('114000.00');
    await expect(page.locator('#invoiceExpectedDisplay')).toHaveText('111000.00');

    await page.fill('#invoiceWhtRate', '5');
    await expect(page.locator('#invoiceExpectedDisplay')).toHaveText('109000.00');

    await page.uncheck('#invoiceWhtApplies');
    await expect(page.locator('#invoiceWhtField')).toBeHidden();
    await expect(page.locator('#invoiceExpectedWrap')).toBeHidden();
    await page.click('#invoiceModal .modal-close');
  });

  test('Saved draft stores 3% when ticked and 0 when not', async ({ page }) => {
    const fill = async (num, tick) => {
      await page.selectOption('#invoiceCustomerId', { index: 1 });
      await page.fill('#invoiceNumber', num);
      await page.fill('#invoiceDueDate', '2026-12-31');
      const line = page.locator('#invoiceLinesBody tr').first();
      await line.locator("input[type='text']").fill('Service');
      await line.locator('.inv-qty').fill('1');
      await line.locator('.inv-price').fill('1000');
      if (tick) await page.check('#invoiceWhtApplies');
      await page.click('#invoiceSaveDraftBtn');
      await expect(page.locator('#invoiceModal')).not.toBeVisible();
    };
    await fill('INV-WHT-T1', true);
    await page.click('#financeNewInvoiceBtn');
    await fill('INV-WHT-T2', false);
    const rates = await page.evaluate(() => {
      const f = (n) => window.FinanceMockState.invoices.find((i) => i.invoice_number === n);
      return [f('INV-WHT-T1').withholding_tax_rate, f('INV-WHT-T2').withholding_tax_rate];
    });
    expect(rates).toEqual([3, 0]);

    // reopening the 3% invoice shows the box ticked
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabQueueAll');
    await page.locator('#financeInvoicesTableBody tr:has-text("INV-WHT-T1") button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceWhtApplies')).toBeChecked();
    await expect(page.locator('#invoiceWhtRate')).toHaveValue('3');
    await page.click('#invoiceModal .modal-close');
  });
});
