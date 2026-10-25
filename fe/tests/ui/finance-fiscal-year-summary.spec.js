import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// FY-1: Yearly Summary tab in Reports (mock mode).
test.describe('FY-1: Yearly Summary report', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin');
    await page.waitForLoadState('networkidle');
    await openAdminPage(page, 'a-finance-reports');
    // Reports open on the library; the sub navigation lives in the report shell
    await page.evaluate(() => window.openReportFromLibrary('fiscal-year-summary'));
    await expect(page.locator('#reportPaneFiscalYear')).toBeVisible();
  });

  test('shows the year selector, account table with totals per currency, and the spend table', async ({ page }) => {
    const pane = page.locator('#reportPaneFiscalYear');
    await expect(pane).toBeVisible();
    await expect(page.locator('[data-report-tab="fiscal-year-summary"]')).toHaveClass(/active/);

    const year = pane.locator('#reportFiscalYear');
    await expect(year.locator('option').first()).toHaveText(String(new Date().getFullYear()));
    await expect(year.locator('option')).toHaveCount(7);

    await expect(pane.locator('#reportFiscalYearTableBody tr').first()).toBeVisible();
    await expect(pane.locator('#reportFiscalYearTable th')).toContainText(['Opening', 'Money in', 'Money out', 'Closing']);
    await expect(pane.locator('#reportFiscalYearTotals tr').first()).toContainText('Total');

    // spend: per currency, own-account transfers in the same country are listed as not counted
    await expect(pane.locator('#reportFiscalYearSpendBody')).toContainText('Payroll');
    await expect(pane.locator('#reportFiscalYearSpendBody .fy-spend-total')).toContainText('Total spend');
    await expect(pane.locator('#reportFiscalYearSpendBody .fy-spend-excluded')).toContainText('same country');
    await expect(pane.locator('#reportFiscalYearNote')).toContainText('transfers between your own accounts');
  });

  test('changing the year reloads the report', async ({ page }) => {
    const year = page.locator('#reportFiscalYear');
    const target = String(new Date().getFullYear() - 1);
    await year.selectOption(target);
    await expect(year).toHaveValue(target);
    await expect(page.locator('#reportFiscalYearTableBody tr').first()).toBeVisible();
  });

  test('has an Excel export button', async ({ page }) => {
    await expect(page.locator('#reportFiscalYearExport')).toBeVisible();
  });
});
