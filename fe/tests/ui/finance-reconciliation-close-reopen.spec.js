import { test, expect } from '@playwright/test';

test.describe('Story 6.4: Reconcile, Close, and Reopen Controls', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Accounts workspace
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Switch to Statements subtab
    await page.click('#subtabFinanceStatements');
    await expect(page.locator('#financeSubPaneStatements')).toBeVisible();

    // Open reconciliation modal
    const reviewBtn = page.locator('.btn-review-statement').first();
    await expect(reviewBtn).toBeVisible({ timeout: 5000 });
    await reviewBtn.click();
    await expect(page.locator('#financeReconciliationModal')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1 & AC 2: Zero-difference gate & documented exception override close workflow', async ({ page }) => {
    const reconModal = page.locator('#financeReconciliationModal');

    // Click Close Period button
    const closePeriodBtn = reconModal.locator('#btnFinalizeReconciliation');
    await expect(closePeriodBtn).toBeVisible();
    await closePeriodBtn.click();

    // Verify Close Period Modal opens
    const closeModal = page.locator('#reconcileCloseModal');
    await expect(closeModal).toBeVisible();

    // Unmatched lines exist -> Variance warning and override section should be visible
    await expect(closeModal.locator('#closeModalVarianceWarning')).toBeVisible();
    const overrideSection = closeModal.locator('#closeModalOverrideSection');
    await expect(overrideSection).toBeVisible();

    // Click exception override checkbox
    const overrideCheckbox = closeModal.locator('#closeExceptionOverrideCheckbox');
    await overrideCheckbox.check();

    // Override reason textarea appears
    const reasonContainer = closeModal.locator('#closeExceptionReasonContainer');
    await expect(reasonContainer).toBeVisible();
    const reasonInput = closeModal.locator('#closeExceptionOverrideReason');
    await reasonInput.fill('CFO authorized exception override for month-end cutoff');

    // Add closing notes
    await closeModal.locator('#closePeriodNotes').fill('Audited close for September 2026');

    // Submit close
    await closeModal.locator('#btnConfirmClosePeriod').click();

    // Verify modal closes and period status changes to Closed
    await expect(closeModal).not.toBeVisible({ timeout: 5000 });
    const statusBadge = reconModal.locator('#reconcileSummaryStatus');
    await expect(statusBadge).toContainText('Closed');

    // Verify action buttons: Close button hidden, Reopen button visible
    await expect(reconModal.locator('#btnFinalizeReconciliation')).not.toBeVisible();
    await expect(reconModal.locator('#reconcileReopenPeriodBtn')).toBeVisible();
  });

  test('AC 3 & AC 4: Audited reopen workflow requires reason and resets state', async ({ page }) => {
    const reconModal = page.locator('#financeReconciliationModal');

    // First close the period with override
    await reconModal.locator('#btnFinalizeReconciliation').click();
    const closeModal = page.locator('#reconcileCloseModal');
    await expect(closeModal).toBeVisible();
    await closeModal.locator('#closeExceptionOverrideCheckbox').check();
    await closeModal.locator('#closeExceptionOverrideReason').fill('Authorized close');
    await closeModal.locator('#btnConfirmClosePeriod').click();
    await expect(closeModal).not.toBeVisible({ timeout: 5000 });

    // Click Reopen Period button
    const reopenBtn = reconModal.locator('#reconcileReopenPeriodBtn');
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();

    // Reopen Modal appears
    const reopenModal = page.locator('#reconcileReopenModal');
    await expect(reopenModal).toBeVisible();

    // Fill mandatory audit reason
    const reopenReasonInput = reopenModal.locator('#reopenPeriodReason');
    await reopenReasonInput.fill('Reopening to include discovered unposted bank adjustment');

    // Submit reopen
    await reopenModal.locator('#btnConfirmReopenPeriod').click();

    // Verify modal closes and status becomes Reopened
    await expect(reopenModal).not.toBeVisible({ timeout: 5000 });
    const statusBadge = reconModal.locator('#reconcileSummaryStatus');
    await expect(statusBadge).toContainText('Reopened');

    // Reopen button hidden, Close button visible again
    await expect(reconModal.locator('#reconcileReopenPeriodBtn')).not.toBeVisible();
    await expect(reconModal.locator('#btnFinalizeReconciliation')).toBeVisible();
  });

  test('AC 5: Completion report generates balances, breakdown metrics, and print option', async ({ page }) => {
    const reconModal = page.locator('#financeReconciliationModal');

    // Click "Completion Report" button in footer
    const reportBtn = reconModal.locator('#reconcileCompletionReportBtn');
    await expect(reportBtn).toBeVisible();
    await reportBtn.click();

    // Completion Report Modal appears
    const reportModal = page.locator('#reconciliationCompletionReportModal');
    await expect(reportModal).toBeVisible();

    // Verify report header and structure
    const printArea = reportModal.locator('#completionReportPrintArea');
    await expect(printArea.locator('h2')).toContainText('Bank Reconciliation Completion Report');
    await expect(printArea).toContainText('Opening Balance');
    await expect(printArea).toContainText('Statement Closing');
    await expect(printArea).toContainText('Continuous Book Bal');
    await expect(printArea).toContainText('Balance Difference');
    await expect(printArea).toContainText('Reconciliation Line Resolution Summary');

    // Verify print button is available
    const printBtn = reportModal.locator('button:has-text("Print / Export Report")');
    await expect(printBtn).toBeVisible();

    // Close report modal
    await reportModal.locator('.modal-close').click();
    await expect(reportModal).not.toBeVisible();
  });
});
