import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// The invoice list opens newest issue date first, the Invoice header sorts by invoice number (not customer),
// and a customer dropdown filters the list. The customers page has no second invoice list.
test.describe('Invoices: default order, invoice-number sort, customer filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible();
  });

  const numbers = (page) => page.locator('#financeInvoicesTableBody tr .fv-link').allTextContents();

  test('opens newest issue date first, ties by invoice number', async ({ page }) => {
    const expected = await page.evaluate(() =>
      [...FinanceState.invoices]
        .sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)) || String(b.invoice_number).localeCompare(String(a.invoice_number), undefined, { numeric: true }))
        .slice(0, 10)
        .map((i) => i.invoice_number));
    expect(await numbers(page)).toEqual(expected);
    await expect(page.locator('#financeInvoicesTable th[data-sort="issue_date"]')).toHaveAttribute('aria-sort', 'descending');
  });

  test('the Invoice header sorts by invoice number, then back to the default', async ({ page }) => {
    const th = page.locator('#financeInvoicesTable th[data-sort="invoice_number"]');
    await th.click();
    const asc = await numbers(page);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    await th.click();
    const desc = await numbers(page);
    expect(desc).toEqual([...asc].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, desc.length));
    await th.click(); // third click clears the sort: the default order returns
    await expect(page.locator('#financeInvoicesTable th[data-sort="issue_date"]')).toHaveAttribute('aria-sort', 'descending');
  });

  test('the customer dropdown narrows the list and All customers brings it back', async ({ page }) => {
    const all = await page.locator('#financeInvoicesTableBody tr').count();
    await page.selectOption('#financeInvoiceCustomerFilter', { label: 'Apex Health Partners' });
    const rows = page.locator('#financeInvoicesTableBody tr');
    await expect(rows).toHaveCount(await page.evaluate(() => FinanceState.invoices.filter((i) => i.customer_name === 'Apex Health Partners').length));
    for (const text of await rows.allTextContents()) expect(text).toContain('Apex Health Partners');
    await page.click('#tabQueuePaid'); // composes with the status pills
    await expect(page.locator('#financeInvoicesTableBody tr')).toHaveCount(0);
    await page.click('#tabQueueAll');
    await page.selectOption('#financeInvoiceCustomerFilter', { label: 'All customers' });
    await expect(rows).toHaveCount(all);
  });

  test('the customers page has no invoice-list button', async ({ page }) => {
    await page.click('#tabFinanceCustomers');
    await expect(page.locator('#financeCustomersTableBody tr').first()).toBeVisible();
    await expect(page.locator('.btn-customer-invoices')).toHaveCount(0);
  });
});
