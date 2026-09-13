import { test, expect } from '@playwright/test';

test.describe('Finance Bank Statement Imports & Reconciliation UI Testing', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to local mock admin application
    await page.goto('/?mock=admin');
    await page.waitForLoadState('networkidle');

    // Navigate to Bank Accounts via sidebar
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await page.waitForTimeout(400);
  });

  test('Statements Tab: renders subtab, upload button, and import history table', async ({ page }) => {
    const section = page.locator('#a-finance-accounts');
    await expect(section).toBeVisible();

    // Click Statements subtab
    const statementsTab = page.locator('[data-account-tab="statements"]');
    await expect(statementsTab).toBeVisible();
    await statementsTab.click();
    await page.waitForTimeout(300);

    // Verify subtab is active and panel visible
    await expect(statementsTab).toHaveClass(/active/);
    const statementsPanel = page.locator('#accountTabStatements');
    await expect(statementsPanel).toBeVisible();

    // Verify Upload Statement button exists
    const uploadBtn = page.locator('#btnUploadStatement');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toContainText('Upload Statement');

    // Verify table structure
    const table = page.locator('#statementImportsTable');
    await expect(table).toBeVisible();
  });

  test('Upload Statement Modal: opens, verifies fields, and closes', async ({ page }) => {
    // Click Statements subtab
    const statementsTab = page.locator('[data-account-tab="statements"]');
    await statementsTab.click();
    await page.waitForTimeout(300);

    // Open Upload Statement modal
    const uploadBtn = page.locator('#btnUploadStatement');
    await uploadBtn.click();
    await page.waitForTimeout(300);

    const modal = page.locator('#financeStatementUploadModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-v2-box')).toBeVisible();

    // Check account select & month input
    const accountSelect = modal.locator('#stmtUploadAccountId');
    await expect(accountSelect).toBeVisible();

    const periodInput = modal.locator('#stmtUploadPeriodMonth');
    await expect(periodInput).toBeVisible();

    const fileInput = modal.locator('#stmtUploadFile');
    await expect(fileInput).toBeAttached();

    // Close modal via Cancel button
    const cancelBtn = modal.locator('[data-modal-dismiss]').first();
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await expect(modal).not.toBeVisible();
  });

  test('Reconciliation Review Drawer / Modal: opens and displays statement lines', async ({ page }) => {
    // Click Statements subtab
    const statementsTab = page.locator('[data-account-tab="statements"]');
    await statementsTab.click();
    await page.waitForTimeout(300);

    // Check if review button exists in table, click the first available
    const reviewBtn = page.locator('.btn-review-statement').first();
    if (await reviewBtn.isVisible()) {
      await reviewBtn.click();
      await page.waitForTimeout(400);

      const reviewModal = page.locator('#financeReconciliationModal');
      await expect(reviewModal).toBeVisible();
      await expect(reviewModal.locator('.modal-v2-box')).toBeVisible();

      // Check summary stats and lines table
      await expect(reviewModal.locator('#reconcileSummaryPeriod')).toBeVisible();
      await expect(reviewModal.locator('#reconciliationLinesTable')).toBeVisible();

      // Close modal
      const closeBtn = reviewModal.locator('[data-modal-dismiss]').first();
      await closeBtn.click();
      await page.waitForTimeout(300);
      await expect(reviewModal).not.toBeVisible();
    }
  });

  test('Theme toggle: dark mode styling works cleanly on statements section', async ({ page }) => {
    // Click Statements subtab
    const statementsTab = page.locator('[data-account-tab="statements"]');
    await statementsTab.click();
    await page.waitForTimeout(300);

    // Toggle dark mode
    const themeToggle = page.locator('#themeToggle, [data-action="toggle-theme"]').first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(300);

      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'));
      expect(isDark).toBeTruthy();

      // Ensure statements table is still visible and correctly styled
      const statementsPanel = page.locator('#accountTabStatements');
      await expect(statementsPanel).toBeVisible();
    }
  });

});
