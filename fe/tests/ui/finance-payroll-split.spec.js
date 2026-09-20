import { test, expect } from '@playwright/test';

test.describe('FUX-417: Payroll Run Compensation Split & FX Rate Policy', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
  });

  test('Step 1 selects FX Rate Policy and Step 2 displays split lines with Component badges', async ({ page }) => {
    // Open wizard
    await page.click('#btnRunPayrollWizard');
    const wizardModal = page.locator('#runPayrollWizardModal');
    await expect(wizardModal).toBeVisible();

    // Step 1: Check FX Rate Policy selectors
    await expect(page.locator('#wizardStep1')).toBeVisible();
    await page.fill('#wizardPeriodLabel', '2026-10');
    await expect(page.locator('#wizardFxRateSource')).toBeVisible();
    await expect(page.locator('#wizardFxRateValue')).toBeVisible();

    // Select "Payment Date (Spot Rate)" and enter custom FX rate
    await page.selectOption('#wizardFxRateSource', 'payment_date');
    await page.fill('#wizardFxRateValue', '49.5000');

    // Move to Step 2
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep2')).toBeVisible();

    // Verify recipient review rows in preview
    const previewRows = page.locator('#wizardRecipientReviewsBody .recipient-review-row');
    await expect(previewRows).toHaveCount(2);

    // Sarah Connor should have recipient review row with EXT ($10,000.00) and INT ($5,000.00)
    const sarahRow = page.locator('#wizardRecipientReviewsBody .recipient-review-row:has-text("Sarah Connor")');
    await expect(sarahRow).toBeVisible();
    await expect(sarahRow).toContainText('$10,000.00');
    await expect(sarahRow).toContainText('$5,000.00');

    // Step 3 -> 4
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep4')).toBeVisible();

    // Submit Run
    await page.click('#btnWizardSubmitForApproval');

    // Detail Modal opens
    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();

    // Approve run
    await detailModal.locator('#btnRunDetailApprove').click();

    // Locked FX Rate card should display rate and source
    const fxRateCard = page.locator('#runDetailFxRate');
    await expect(fxRateCard).toBeVisible();
    await expect(fxRateCard).toContainText('49.5000');
    await expect(fxRateCard).toContainText('Payment Date');

    // Lines table in detail modal should render Component badges
    const detailExternalBadge = page.locator('#runDetailLinesTableBody tr:has-text("Sarah Connor") .badge:has-text("External USD")');
    const detailInternalBadge = page.locator('#runDetailLinesTableBody tr:has-text("Sarah Connor") .badge:has-text("Internal USD Cash")');
    await expect(detailExternalBadge).toBeVisible();
    await expect(detailInternalBadge).toBeVisible();

    // Clean teardown
    await page.click('#payrollRunDetailModal .modal-close');
    await expect(detailModal).not.toBeVisible();
  });
});
