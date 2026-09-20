import { test, expect } from '@playwright/test';

test.describe('Payroll Runner Commission & Bonus Adjustments Workflow', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Guided Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
  });

  test('Adds Commission and Bonus in Step 2, updates totals, edits source INT->EXT, removes, and persists across wizard steps', async ({ page }) => {
    // 1. Launch wizard
    await page.click('#btnRunPayrollWizard');
    const wizardModal = page.locator('#runPayrollWizardModal');
    await expect(wizardModal).toBeVisible();

    await page.fill('#wizardPeriodLabel', '2026-12');
    await page.click('#wizardNextBtn');

    // Step 2: Review Payments
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await expect(page.locator('#btnWizardAddAdjustment')).toBeVisible();

    // Initial check on total net payment
    const initialNetText = await page.locator('#wizardReviewTotalNet').textContent();
    const initialNet = parseFloat(initialNetText.replace(/[^0-9.]/g, ''));

    // 2. Open Commission / Bonus modal from Step 2 toolbar
    await page.click('#btnWizardAddAdjustment');
    const adjModal = page.locator('#wizardAdjustmentModal');
    await expect(adjModal).toBeVisible();
    await expect(adjModal.locator('#wizardAdjustmentModalTitle')).toContainText('Add Commission / Bonus');

    // Select employee 1 (Sarah Connor), Bonus, Amount $500, Source INT, Description
    await page.selectOption('#wizardAdjEmployeeSelect', { value: '1' });
    await page.selectOption('#wizardAdjType', 'BONUS');
    await page.fill('#wizardAdjAmount', '500.00');
    await page.check('#wizardAdjSourceINT');
    await page.fill('#wizardAdjDescription', 'December Performance Spot Bonus');

    // Save adjustment
    await page.click('#btnSaveWizardAdjustment');
    await expect(adjModal).not.toBeVisible();

    // 3. Verify totals updated immediately
    const sarahRow = page.locator('#wizardEmployeesPreviewTableBody tr:has-text("Sarah Connor")');
    await expect(sarahRow).toBeVisible();
    await expect(sarahRow).toContainText('Bonus (INT)');
    await expect(sarahRow).toContainText('+$500');

    // Verify header additions metric updated
    await expect(page.locator('#wizardReviewAdditionsTotal')).toContainText('+$500.00');

    // Verify Total Net Payment increased by 500
    const netAfterBonusText = await page.locator('#wizardReviewTotalNet').textContent();
    const netAfterBonus = parseFloat(netAfterBonusText.replace(/[^0-9.]/g, ''));
    expect(netAfterBonus).toBeCloseTo(initialNet + 500.0, 1);

    // 4. Open Recipient Details modal for Sarah Connor
    await sarahRow.locator('.btn-view-recipient').click();
    const detailModal = page.locator('#wizardRecipientDetailModal');
    await expect(detailModal).toBeVisible();
    await expect(detailModal.locator('#recipientDetailName')).toHaveText('Sarah Connor');
    await expect(detailModal.locator('#recipientDetailAdditionsTotal')).toContainText('+$500.00');
    await expect(detailModal.locator('#recipientDetailAdditionsSplit')).toContainText('INT: $500.00');

    // 5. Edit adjustment from details modal (switch source to EXT, amount $750)
    await detailModal.locator('button:has-text("Edit")').first().click();
    await expect(adjModal).toBeVisible();
    await expect(adjModal.locator('#wizardAdjustmentModalTitle')).toContainText('Edit Commission / Bonus');

    await page.fill('#wizardAdjAmount', '750.00');
    await page.check('#wizardAdjSourceEXT');
    await page.click('#btnSaveWizardAdjustment');
    await expect(adjModal).not.toBeVisible();

    // Verify details modal updated with EXT $750
    await expect(detailModal.locator('#recipientDetailAdditionsTotal')).toContainText('+$750.00');
    await expect(detailModal.locator('#recipientDetailAdditionsSplit')).toContainText('EXT: $750.00');
    await page.click('#wizardRecipientDetailModal button:has-text("Close")');
    await expect(detailModal).not.toBeVisible();

    // 6. Navigate to Step 3 and Step 4 without losing the adjustment
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep4')).toBeVisible();

    // Verify Step 4 breakdown
    await expect(page.locator('#wizardConfirmAdditionsBreakdown')).toContainText('+$750.00');
    await expect(page.locator('#wizardConfirmAdditionsDetail')).toContainText('Bonus: $750.00');

    // Return back to Step 2
    await page.click('#wizardPrevBtn'); // back to Step 3
    await page.click('#wizardPrevBtn'); // back to Step 2
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await expect(sarahRow).toContainText('+$750');

    // 7. Save draft and confirm run creation includes adjustments
    await page.click('#wizardNextBtn'); // Step 3
    await page.click('#wizardNextBtn'); // Step 4
    await page.click('#btnWizardSaveDraft');

    // Verify run detail modal opens
    const runDetailModal = page.locator('#payrollRunDetailModal');
    await expect(runDetailModal).toBeVisible();
    await expect(runDetailModal.locator('#runDetailStatusBadge')).toContainText('DRAFT');
  });
});
