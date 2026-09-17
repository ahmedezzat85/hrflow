import { test, expect } from '@playwright/test';

test.describe('Story 1.2 — Shared Finance Data Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
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

    const totalHeader = table.locator('th[data-sort="total"]');
    await expect(totalHeader).toBeVisible();
    await expect(totalHeader).toHaveAttribute('role', 'columnheader');

    // Click Total header once -> ascending sort
    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');

    // First row should have lowest total ($8,400.00)
    let firstRowText = await table.locator('tbody tr:first-child').textContent();
    expect(firstRowText).toContain('8,400.00');

    // Click Total header again -> descending sort
    await totalHeader.click();
    await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');

    // First row should now have highest total ($12,500.00)
    firstRowText = await table.locator('tbody tr:first-child').textContent();
    expect(firstRowText).toContain('12,500.00');

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

  test('Acceptance Criteria 4: Filter chips render active filters, allow individual removal and clear all', async ({ page }) => {
    const chipsBar = page.locator('#financeInvoiceFilterChips');

    // Filter by status 'draft'
    await page.selectOption('#financeInvoiceStatusFilter', 'draft');
    await expect(chipsBar).toBeVisible();
    await expect(chipsBar).toContainText('Status: draft');

    // Remove status chip via its remove button
    const removeBtn = chipsBar.locator('.filter-chip-remove');
    await removeBtn.click();

    // Status filter input should reset and chip bar hide
    await expect(page.locator('#financeInvoiceStatusFilter')).toHaveValue('');
    await expect(chipsBar).toBeHidden();

    // Type into search
    await page.fill('#financeInvoiceSearch', 'Apex');
    await expect(chipsBar).toBeVisible();
    await expect(chipsBar).toContainText('Search: Apex');

    // Click "Clear all"
    const clearAllBtn = chipsBar.locator('.btn-clear-filters');
    await clearAllBtn.click();
    await expect(page.locator('#financeInvoiceSearch')).toHaveValue('');
    await expect(chipsBar).toBeHidden();
  });

  test('Acceptance Criteria 5: Table view state survives navigation to another section and back', async ({ page }) => {
    // Apply search filter
    await page.fill('#financeInvoiceSearch', 'BioCare');
    const rowsBefore = page.locator('#financeInvoicesTable tbody tr');
    await expect(rowsBefore).toHaveCount(1);
    await expect(rowsBefore).toContainText('BioCare Diagnostics');

    // Navigate away to Spend
    await page.click('#adminSidebar a[data-page="a-finance-spend"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    // Navigate back to Sales
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Filter and search input should still be preserved
    await expect(page.locator('#financeInvoiceSearch')).toHaveValue('BioCare');
    const rowsAfter = page.locator('#financeInvoicesTable tbody tr');
    await expect(rowsAfter).toHaveCount(1);
    await expect(rowsAfter).toContainText('BioCare Diagnostics');
  });
});
