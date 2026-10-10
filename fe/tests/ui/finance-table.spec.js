import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Story 1.2 — Shared Finance Data Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-sales');
    await expect(page.locator('#financeInvoicesTable tbody tr').first()).toBeVisible();
  });

  test('Acceptance Criteria 1: Table density reads from global setting and per-page control is removed', async ({ page }) => {
    // FUX-415: Per-page density controls are deleted from toolbars
    await expect(page.locator('#financeInvoiceDensityControl')).toHaveCount(0);

    // Verify invoice table respects global density
    await page.evaluate(() => FinanceTable.setDensity('compact'));
    await expect(page.locator('#financeInvoicesTable')).toHaveClass(/density-compact/);
    let storageVal = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(storageVal).toBe('compact');

    await page.evaluate(() => FinanceTable.setDensity('spacious'));
    await expect(page.locator('#financeInvoicesTable')).toHaveClass(/density-spacious/);
    storageVal = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(storageVal).toBe('spacious');

    await page.evaluate(() => FinanceTable.setDensity('regular'));
    await expect(page.locator('#financeInvoicesTable')).toHaveClass(/density-regular/);
    storageVal = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(storageVal).toBe('regular');
  });

  test('Acceptance Criteria 2: Column sorting toggles ascending/descending with aria-sort and keyboard support', async ({ page }) => {
    const table = page.locator('#financeInvoicesTable');
    await expect(table).toBeVisible();

    // D-027: the Total column is gone; the Due column sorts the same way
    const totalHeader = table.locator('th[data-sort="due_date"]');
    await expect(totalHeader).toBeVisible();
    await expect(totalHeader).toHaveAttribute('role', 'columnheader');

    // Click Due header once -> ascending sort
    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');

    // First row should have the earliest due date (15 Aug 2026)
    let firstRowText = await table.locator('tbody tr:first-child').textContent();
    expect(firstRowText).toContain('15 Aug 2026');

    // Click Due header again -> descending sort
    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');

    // First row should now have the latest due date (5 Oct 2026)
    firstRowText = await table.locator('tbody tr:first-child').textContent();
    expect(firstRowText).toContain('5 Oct 2026');

    // Test Keyboard navigation (Enter key on Customer Name header)
    const customerHeader = table.locator('th[data-sort="customer_name"]');
    await customerHeader.focus();
    await page.keyboard.press('Enter');
    await expect(customerHeader).toHaveAttribute('aria-sort', 'ascending');

    firstRowText = await table.locator('tbody tr:first-child').textContent();
    expect(firstRowText).toContain('Apex Health Partners');
  });

  test('Acceptance Criteria 3: Pagination controls paginate records, display summary, and change page size', async ({ page }) => {
    const pagination = page.locator('#financeInvoicesPagination');
    await expect(pagination).toBeVisible();

    // Verify initial summary text
    const summary = pagination.locator('.pagination-summary');
    await expect(summary).toContainText('records');

    // Seed 5 records to test full pagination navigation
    await page.evaluate(() => {
      FinanceState.invoices = [
        { id: 1, invoice_number: 'INV-001', customer_name: 'Client A', total: 100, currency: 'USD', status: 'paid' },
        { id: 2, invoice_number: 'INV-002', customer_name: 'Client B', total: 200, currency: 'USD', status: 'draft' },
        { id: 3, invoice_number: 'INV-003', customer_name: 'Client C', total: 300, currency: 'USD', status: 'sent' },
        { id: 4, invoice_number: 'INV-004', customer_name: 'Client D', total: 400, currency: 'USD', status: 'overdue' },
        { id: 5, invoice_number: 'INV-005', customer_name: 'Client E', total: 500, currency: 'USD', status: 'paid' },
      ];
      const state = FinanceTable.getState('finance_invoices');
      state.pageSize = 2;
      state.page = 1;
      FinanceTable.saveState('finance_invoices', state);
      applyAndRenderInvoices();
    });

    await expect(summary).toContainText('Showing 1–2 of 5 records');
    let rows = page.locator('#financeInvoicesTable tbody tr');
    await expect(rows).toHaveCount(2);

    // Click next page button
    const nextBtn = pagination.locator('button[aria-label="Next page"]');
    await nextBtn.click();

    await expect(summary).toContainText('Showing 3–4 of 5 records');
    await expect(pagination).toContainText('Page 2 of 3');

    // Change page size to 10
    const sizeSelect = pagination.locator('.pagination-size-select');
    await sizeSelect.selectOption('10');

    await expect(summary).toContainText('Showing 1–5 of 5 records');
    rows = page.locator('#financeInvoicesTable tbody tr');
    await expect(rows).toHaveCount(5);
  });

  test('Acceptance Criteria 4: The invoice filter chip row is replaced by the status pills', async ({ page }) => {
    // D-027: no "Filters: Status" chip row and no status select; the pills are the status filter
    await expect(page.locator('#financeInvoiceFilterChips')).toHaveCount(0);
    await expect(page.locator('#financeInvoiceStatusFilter')).toHaveCount(0);
    await page.click('#tabQueueDraft');
    await expect(page.locator('#financeInvoicesTable tbody tr')).toHaveCount(1);
    await page.click('#tabQueueAll');
    await page.fill('#financeInvoiceSearch', 'Apex');
    await expect(page.locator('#financeInvoicesTable tbody tr')).toHaveCount(1);
    await page.fill('#financeInvoiceSearch', '');
    await expect(page.locator('#financeInvoicesTable tbody tr')).toHaveCount(6);
  });

  test('Acceptance Criteria 5: Table view state survives navigation to another section and back', async ({ page }) => {
    // Apply search filter
    await page.fill('#financeInvoiceSearch', 'BioCare');
    const rowsBefore = page.locator('#financeInvoicesTable tbody tr');
    await expect(rowsBefore).toHaveCount(1);
    await expect(rowsBefore).toContainText('BioCare Diagnostics');

    // Navigate away to Spend
    await openAdminPage(page, 'a-finance-spend');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    // Navigate back to Sales
    await openAdminPage(page, 'a-finance-sales');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Filter and search input should still be preserved
    await expect(page.locator('#financeInvoiceSearch')).toHaveValue('BioCare');
    const rowsAfter = page.locator('#financeInvoicesTable tbody tr');
    await expect(rowsAfter).toHaveCount(1);
    await expect(rowsAfter).toContainText('BioCare Diagnostics');
  });
});
