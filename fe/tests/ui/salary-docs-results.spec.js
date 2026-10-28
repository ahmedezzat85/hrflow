import { test, expect } from '@playwright/test';

test.describe('Salary payment docs results table', () => {
  test('batch results use the shared columns with a separate Details column', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => showSection('a-invoices', 'admin'));

    await page.evaluate(() => renderInvoiceBatchResults({
      results: [
        { employee_id: 1, employee_name: 'Sara Ali', status: 'generated', invoice_number: 'PD-2026-001', drive_web_url: 'https://example.test/doc' },
        { employee_id: 2, employee_name: 'Omar Hany', status: 'skipped', reason: 'No external salary' },
      ],
    }, 2026, 5));

    const headers = page.locator('#invoiceResultsTable thead th');
    await expect(headers).toHaveCount(6);
    await expect(headers.nth(4)).toHaveText('Details');

    const rows = page.locator('#invoiceResultsBody tr');
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(rows.nth(i).locator('td')).toHaveCount(6);
      // name cell must stay a real table cell so row borders are continuous
      await expect(rows.nth(i).locator('td.tname')).toHaveCSS('display', 'table-cell');
    }
    await expect(rows.nth(0).locator('td').nth(3)).not.toContainText('PD-2026-001');
    await expect(rows.nth(0).locator('td').nth(4)).toHaveText('PD-2026-001');
    await expect(rows.nth(1).locator('td').nth(4)).toHaveText('No external salary');
  });

  test('bulk dialog shows progress and locks while generating', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => { openModal('bulkInvoiceModal'); _setBulkGenerateBusy(true); });
    await expect(page.locator('#bulkGenerateProgress')).toBeVisible();
    await expect(page.locator('#btnCancelBulkGenerate')).toBeDisabled();
    await expect(page.locator('#bulkRegenerateExisting')).toBeDisabled();
    await page.evaluate(() => { _setBulkGenerateBusy(false); closeModal('bulkInvoiceModal'); });
    await expect(page.locator('#bulkGenerateProgress')).toBeHidden();
  });
});
