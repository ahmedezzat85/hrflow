import { test, expect } from '@playwright/test';
import { openPay } from './helpers/pay-analytics.js';

const rowsOf = (page) => page.locator('#payMonthlyTable tbody tr');

test.describe('Pay analytics: monthly breakdown and export', () => {
  test('table shows five newest rows, expands, and agrees with the summary', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payMonthlyTable')).toBeVisible();
    await expect(rowsOf(page)).toHaveCount(5);
    await expect(rowsOf(page).first()).toContainText('Oct 2026');
    await expect(rowsOf(page).first()).toContainText('Draft');
    await expect(rowsOf(page).nth(1)).toContainText('Pending');
    await expect(rowsOf(page).nth(2)).toContainText('Paid · 28 Aug 2026');
    await expect(page.locator('#payShowAllBtn')).toHaveText('Show all 9 months');
    await page.click('#payShowAllBtn');
    await expect(rowsOf(page)).toHaveCount(9);
    await expect(page.locator('#payShowAllBtn')).toHaveCount(0);
    // footer total equals the summary's Total paid and the sum of the rows
    const footer = (await page.locator('#payMonthlyTable tfoot td.pay-num--total').innerText()).trim();
    await expect(page.locator('#paySummary')).toContainText(footer);
    const rowsTotal = await page.locator('#payMonthlyTable tbody td.pay-num--total').allInnerTexts();
    const n = (t) => Number(t.replace(/[^0-9.]/g, ''));
    expect(rowsTotal.map(n).reduce((x, y) => x + y, 0)).toBeCloseTo(n(footer), 2);
  });

  test('export menu offers xlsx and csv, and downloads a file', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payExportBtn')).toBeVisible();
    await page.click('#payExportBtn');
    await expect(page.locator('#payExportMenu')).toBeVisible();
    await expect(page.locator('#payExportMenu [role="menuitem"]')).toHaveText(['Monthly breakdown (.xlsx)', 'Monthly breakdown (.csv)', 'Raise history (.csv)']);
    await expect(page.locator('#payExportMenu')).toContainText('Exports include only the sections shown on this page');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#payExportMenu [data-export="monthly-xlsx"]')]);
    expect(dl.suggestedFilename()).toBe('pay-1-monthly.xlsx');
    await expect(page.locator('#payExportMenu')).toBeHidden();
  });

  test('export button is disabled while the request runs and failure shows an error toast', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payExportBtn')).toBeVisible();
    await page.evaluate(() => {
      window.__release = null;
      AnalyticsApi.exportEmployeePay = () => new Promise((_, reject) => { window.__release = () => reject(new Error('Export failed (500)')); });
    });
    await page.click('#payExportBtn');
    await page.click('#payExportMenu [data-export="monthly-csv"]');
    await expect(page.locator('#payExportBtn')).toBeDisabled();
    await expect(page.locator('#payExportBtn')).toContainText('Exporting');
    await page.evaluate(() => window.__release());
    await expect(page.locator('#toastWrap .toast-error')).toContainText('Export failed (500)');
    await expect(page.locator('#payExportBtn')).toBeEnabled();
  });

  test('HR-only export offers only Raise history', async ({ page }) => {
    await openPay(page, 'hr');
    await page.click('#employeePayTab');
    await page.click('#payExportBtn');
    await expect(page.locator('#payExportMenu [role="menuitem"]')).toHaveText(['Raise history (.csv)']);
    await expect(page.locator('#payMonthlyTable')).toHaveCount(0);
  });

  test('quarterly grouping relabels the table', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await page.click('#payGroupBy button[data-group="quarter"]');
    await expect(page.locator('#payMonthlyTable thead th').first()).toHaveText('Quarter');
    await expect(rowsOf(page).first()).toContainText('Q4 2026');
  });

  test('error state shows Retry that reloads', async ({ page }) => {
    await openPay(page, 'admin');
    await page.evaluate(() => { window.__fail = true; const o = AnalyticsApi.getEmployeePay; AnalyticsApi.getEmployeePay = (...a) => (window.__fail ? Promise.reject(new Error('Server unavailable')) : o.apply(AnalyticsApi, a)); });
    await page.click('#employeePayTab');
    await expect(page.locator('#payBody')).toContainText('Server unavailable');
    await page.evaluate(() => { window.__fail = false; });
    await page.click('#payRetryBtn');
    await expect(page.locator('#payMonthlyTable')).toBeVisible();
  });
});
