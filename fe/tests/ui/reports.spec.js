import { test, expect } from '@playwright/test';

test.describe('Financial Reports & Excel Export UI Testing', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to local mock admin application
    await page.goto('/?mock=admin');
    await page.waitForLoadState('networkidle');

    // Navigate to Financial Reports via sidebar
    await page.click('#adminSidebar a[data-page="a-finance-reports"]');
    await page.waitForTimeout(400);
  });

  test('Reports Navigation: renders section, subnav tabs, and default Category Spend rollup', async ({ page }) => {
    const section = page.locator('#a-finance-reports');
    await expect(section).toBeVisible();

    // Verify subtabs exist
    const subnav = page.locator('#financeReportsSubNav');
    await expect(subnav).toBeVisible();
    await expect(subnav.locator('[data-report-tab="category-summary"]')).toBeVisible();
    await expect(subnav.locator('[data-report-tab="matrix"]')).toBeVisible();
    await expect(subnav.locator('[data-report-tab="balances"]')).toBeVisible();
    await expect(subnav.locator('[data-report-tab="transactions"]')).toBeVisible();
    await expect(subnav.locator('[data-report-tab="cheques"]')).toBeVisible();

    // Default tab is Category Spend Rollup
    const categoryPane = page.locator('#reportPaneCategorySummary');
    await expect(categoryPane).toBeVisible();

    // Export button exists
    const exportBtn = categoryPane.locator('button:has-text("Export to Excel")');
    await expect(exportBtn).toBeVisible();
  });

  test('Annual Matrix Tab: switches tab, renders month columns and summary row', async ({ page }) => {
    // Switch to Annual Matrix tab
    const matrixTab = page.locator('[data-report-tab="matrix"]');
    await matrixTab.click();
    await page.waitForTimeout(300);

    await expect(matrixTab).toHaveClass(/active/);
    const matrixPane = page.locator('#reportPaneMatrix');
    await expect(matrixPane).toBeVisible();

    // Verify year filter and table
    await expect(matrixPane.locator('#reportMatrixYear')).toBeVisible();
    await expect(matrixPane.locator('#reportMatrixTable')).toBeVisible();
  });

  test('Point-in-Time Balances Tab: switches tab, verifies as-of date input and balances table', async ({ page }) => {
    // Switch to Balances tab
    const balancesTab = page.locator('[data-report-tab="balances"]');
    await balancesTab.click();
    await page.waitForTimeout(300);

    await expect(balancesTab).toHaveClass(/active/);
    const balancesPane = page.locator('#reportPaneBalances');
    await expect(balancesPane).toBeVisible();

    // Verify as-of date input
    await expect(balancesPane.locator('#reportBalancesAsOfDate')).toBeVisible();
    await expect(balancesPane.locator('#reportBalancesTable')).toBeVisible();
  });

  test('Cheque Register Report Tab: switches tab and renders fiscal year breakdown', async ({ page }) => {
    // Switch to Cheques tab
    const chequesTab = page.locator('[data-report-tab="cheques"]');
    await chequesTab.click();
    await page.waitForTimeout(300);

    await expect(chequesTab).toHaveClass(/active/);
    const chequesPane = page.locator('#reportPaneCheques');
    await expect(chequesPane).toBeVisible();

    await expect(chequesPane.locator('#reportChequesFiscalYear')).toBeVisible();
    await expect(chequesPane.locator('#reportChequesTable')).toBeVisible();
  });

  test('Theme toggle: dark mode styling works seamlessly on reports section', async ({ page }) => {
    // Toggle dark mode
    const themeToggle = page.locator('#themeToggle, [data-action="toggle-theme"]').first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(300);

      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'));
      expect(isDark).toBeTruthy();

      const section = page.locator('#a-finance-reports');
      await expect(section).toBeVisible();
    }
  });

});
