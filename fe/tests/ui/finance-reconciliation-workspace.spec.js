import { test, expect } from '@playwright/test';

test.describe('Story 6.2: Side-by-side reconciliation workspace', () => {
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

    // Open reconciliation modal for first statement import
    const reviewBtn = page.locator('.btn-review-statement').first();
    await expect(reviewBtn).toBeVisible({ timeout: 5000 });
    await reviewBtn.click();

    await expect(page.locator('#financeReconciliationModal')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1 & AC 2: Displays live KPI balance bar, rationale badges, and confirms 1-click match', async ({ page }) => {
    const modal = page.locator('#financeReconciliationModal');

    // Verify Persistent Top KPI Balance Bar
    await expect(modal.locator('#reconcileStatementClosingVal')).toBeVisible();
    await expect(modal.locator('#reconcileBookBalanceVal')).toBeVisible();
    await expect(modal.locator('#reconcileDifferenceVal')).toBeVisible();
    await expect(modal.locator('#reconcileResolvedAmountVal')).toBeVisible();
    await expect(modal.locator('#reconcileRemainingCountVal')).toBeVisible();

    // Line 2 has candidate match with score and rationale badge
    const line2Row = modal.locator('#stmtLineRow_2');
    await expect(line2Row).toBeVisible();

    // Verify candidate match select and rationale badge
    const select = line2Row.locator('#lineMatchSelect_2');
    await expect(select).toBeVisible();
    const rationale = line2Row.locator('#matchRationaleText_2');
    await expect(rationale).toBeVisible();
    await expect(rationale).toContainText('Exact amount match');

    // Click 1-click Match button
    const matchBtn = line2Row.locator('.btn-confirm-match');
    await expect(matchBtn).toBeVisible();
    await matchBtn.click();

    // Status updates to Matched and remaining lines count decreases
    await expect(line2Row.getByText('Matched', { exact: true })).toBeVisible();
  });

  test('AC 3: Split statement line enforces precision sum and creates child portions', async ({ page }) => {
    const modal = page.locator('#financeReconciliationModal');

    // Line 3 ($15.00 fee) click Split button
    const line3Row = modal.locator('#stmtLineRow_3');
    await expect(line3Row).toBeVisible();

    const splitBtn = line3Row.locator('.btn-split-line');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    // Split modal opens
    const splitModal = page.locator('#reconcileSplitModal');
    await expect(splitModal).toBeVisible();

    // Check source amount is displayed
    await expect(splitModal.locator('#reconcileSplitSourceAmountVal')).toContainText('$15.00');

    // Two portion rows should be initialized with 7.50 and 7.50, sum $15.00 -> Balanced
    const diffBadge = splitModal.locator('#reconcileSplitDiffBadge');
    await expect(diffBadge).toContainText('Balanced');

    const confirmBtn = splitModal.locator('#btnConfirmSplitPortions');
    await expect(confirmBtn).toBeEnabled();

    // Change first input to 10.00 -> unbalanced
    const inputs = splitModal.locator('.split-amount-input');
    await inputs.first().fill('10.00');

    // Difference badge now shows unbalanced and confirm button is disabled
    await expect(diffBadge).toContainText('Diff');
    await expect(confirmBtn).toBeDisabled();

    // Adjust second input to 5.00 -> balanced again
    await inputs.nth(1).fill('5.00');
    await expect(diffBadge).toContainText('Balanced');
    await expect(confirmBtn).toBeEnabled();

    // Submit split
    await confirmBtn.click();
    await expect(splitModal).not.toBeVisible();

    // Line 3 now shows as Split
    await expect(line3Row.getByText('Split', { exact: true })).toBeVisible();
  });

  test('AC 4: Ignore line requires documented audit reason', async ({ page }) => {
    const modal = page.locator('#financeReconciliationModal');

    // Line 3 click Ignore button
    const line3Row = modal.locator('#stmtLineRow_3');
    await expect(line3Row).toBeVisible();

    const ignoreBtn = line3Row.locator('.btn-ignore-line');
    await expect(ignoreBtn).toBeVisible();
    await ignoreBtn.click();

    // Ignore modal opens
    const ignoreModal = page.locator('#reconcileIgnoreModal');
    await expect(ignoreModal).toBeVisible();

    const reasonInput = ignoreModal.locator('#reconcileIgnoreReason');
    await expect(reasonInput).toBeVisible();

    // Submit with reason
    const submitBtn = ignoreModal.locator('button[type="submit"]');
    await reasonInput.fill('Non-operating fee absorbed by parent entity per board resolution');
    await submitBtn.click();

    await expect(ignoreModal).not.toBeVisible();
    await expect(line3Row.getByText('Ignored')).toBeVisible();
  });
});
