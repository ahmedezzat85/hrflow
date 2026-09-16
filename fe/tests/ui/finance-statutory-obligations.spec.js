import { test, expect } from '@playwright/test';

test.describe('FUX-410: Statutory Obligations Tracker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-statutory"]');
    await expect(page.locator('#a-finance-statutory')).toBeVisible();
  });

  test('AC 1 & AC 8: Renders Statutory Obligations view, summary metrics, and table', async ({ page }) => {
    // Check header
    await expect(page.locator('#a-finance-statutory .section-title')).toContainText('Statutory Obligations');
    await expect(page.locator('#financeAddStatutoryBtn')).toBeVisible();

    // Check summary metric cards
    await expect(page.locator('#statutorySummaryEstimated')).toBeVisible();
    await expect(page.locator('#statutorySummaryAccrued')).toBeVisible();
    await expect(page.locator('#statutorySummaryRemitted')).toBeVisible();
    await expect(page.locator('#statutorySummaryVariance')).toBeVisible();

    // Check table headers and seeded rows
    const tbody = page.locator('#financeStatutoryTableBody');
    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText('Social Insurance (Employee)');
    await expect(tbody).toContainText('Salary/Income Tax Withheld');
    await expect(tbody).toContainText('Sales Tax / VAT');
  });

  test('AC 4 & AC 5: Confirm / Adjust estimated obligation with variance note', async ({ page }) => {
    const row = page.locator('#financeStatutoryTableBody tr:has-text("Social Insurance (Employee)")');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Estimated');

    // Click Confirm / Adjust
    await row.locator('.btn-stat-confirm').click();
    const modal = page.locator('#statutoryConfirmModal');
    await expect(modal).toBeVisible();

    // Check original estimate display
    await expect(page.locator('#statConfirmEstimateDisplay')).toContainText('1,250.00');

    // Adjust accrued amount to match government portal ($1,295.50)
    await page.fill('#statConfirmAccruedAmount', '1295.50');
    await expect(page.locator('#statConfirmVarianceDisplay')).toContainText('+$45.50');

    // Enter explanation note
    await page.fill('#statConfirmVarianceNote', 'Government portal calculation true-up and processing fee');

    // Submit confirmation
    await page.click('#statConfirmSaveBtn');
    await expect(modal).not.toBeVisible();

    // Verify row transitioned to Accrued with visible variance
    await expect(row).toContainText('Accrued');
    await expect(row).toContainText('1,295.50');
    await expect(row).toContainText('+$45.50');
  });

  test('AC 1 & AC 10: Settle statutory obligation creating atomic remittance', async ({ page }) => {
    const row = page.locator('#financeStatutoryTableBody tr:has-text("Withholding Tax (WHT)")');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Accrued');

    // Click Remit Payment
    await row.locator('.btn-stat-remit').click();
    const modal = page.locator('#statutorySettleModal');
    await expect(modal).toBeVisible();

    // Check obligation info in modal
    await expect(page.locator('#statSettleObligationInfo')).toContainText('Withholding Tax');
    await expect(page.locator('#statSettleAmount')).toHaveValue('850.00');

    // Submit remittance
    await page.click('#statSettleSaveBtn');
    await expect(modal).not.toBeVisible();

    // Verify status updated to Remitted
    await expect(row).toContainText('Remitted');
    await expect(row).toContainText('Settled');
  });

  test('AC 7: Record manual statutory obligation directly in accrued status', async ({ page }) => {
    // Open Record Modal
    await page.click('#financeAddStatutoryBtn');
    const modal = page.locator('#statutoryRecordModal');
    await expect(modal).toBeVisible();

    // Fill form
    await page.selectOption('#statRecordType', 'health_insurance');
    await page.fill('#statRecordPeriod', '2026-09');
    await page.fill('#statRecordAmount', '1750.00');
    await page.fill('#statRecordNotes', 'Direct statutory health insurance assessment');

    // Submit
    await page.click('#statRecordSaveBtn');
    await expect(modal).not.toBeVisible();

    // Verify new row appears with Accrued status
    const newRow = page.locator('#financeStatutoryTableBody tr:has-text("Direct statutory health insurance assessment")');
    await expect(newRow).toBeVisible();
    await expect(newRow).toContainText('Health Insurance');
    await expect(newRow).toContainText('1,750.00');
    await expect(newRow).toContainText('Accrued');
  });

  test('Filtering by status tabs and search', async ({ page }) => {
    const tbody = page.locator('#financeStatutoryTableBody');

    // Filter by Estimated
    await page.click('#financeStatutoryFilterTabs button[data-filter="estimated"]');
    await expect(tbody).toContainText('Social Insurance (Employee)');
    await expect(tbody).not.toContainText('Sales Tax / VAT');

    // Filter by Remitted
    await page.click('#financeStatutoryFilterTabs button[data-filter="remitted"]');
    await expect(tbody).toContainText('Sales Tax / VAT');
    await expect(tbody).not.toContainText('Social Insurance (Employee)');

    // Reset to All and search
    await page.click('#financeStatutoryFilterTabs button[data-filter="all"]');
    await page.fill('#financeStatutorySearch', 'Withholding');
    await expect(tbody).toContainText('Withholding Tax (WHT)');
    await expect(tbody).not.toContainText('Social Insurance (Employee)');
  });
});
