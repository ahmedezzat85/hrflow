import { test, expect } from '@playwright/test';

test.describe('Story 6.3: Reconciliation Rules', () => {
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

  test('AC 1 & AC 2: Rules engine displays ordered rules, and dry-run preview shows affected lines before activation', async ({ page }) => {
    // Click "Rules Engine" button in filter bar
    await page.click('#btnOpenReconciliationRules');
    const rulesModal = page.locator('#financeReconciliationRulesModal');
    await expect(rulesModal).toBeVisible();

    // Rules table should show configured rules
    const rulesTable = rulesModal.locator('#reconciliationRulesTable');
    await expect(rulesTable).toBeVisible();
    await expect(rulesTable.locator('tbody tr')).toHaveCount(2);

    // Open Create Rule modal
    await rulesModal.locator('button:has-text("New Rule")').click();
    const editModal = page.locator('#financeRuleEditModal');
    await expect(editModal).toBeVisible();

    // Fill form
    await editModal.locator('#ruleFormName').fill('Test Cloud Keyword Rule');
    await editModal.locator('#ruleFormPriority').fill('15');
    await editModal.locator('#ruleFormDescPattern').fill('AMAZON|AWS');

    // Trigger Dry-Run Preview
    await editModal.locator('button:has-text("Test / Preview Rule")').click();

    // Verify preview results container is displayed
    const previewBox = editModal.locator('#rulePreviewResultsContainer');
    await expect(previewBox).toBeVisible();
    await expect(previewBox.locator('#rulePreviewSummaryText')).toContainText('Matches');

    // Close modals
    await editModal.locator('.modal-close').click();
    await expect(editModal).not.toBeVisible();
    await rulesModal.locator('.modal-close').click();
    await expect(rulesModal).not.toBeVisible();
  });

  test('AC 3 & AC 4: Execute rules resolves matching statement lines and supports reversible rollback', async ({ page }) => {
    const modal = page.locator('#financeReconciliationModal');

    // Statement line 3 ($15.00 service fee) starts as unmatched
    const line3Row = modal.locator('#stmtLineRow_3');
    await expect(line3Row).toBeVisible();
    await expect(line3Row.getByText('Unmatched')).toBeVisible();

    // Click "Apply Rules" button in filter bar
    await page.click('#btnExecuteStatementRules');
    const confirmModal = page.locator('#financeApplyRulesConfirmModal');
    await expect(confirmModal).toBeVisible();

    // Verify simulation stats
    await expect(confirmModal.locator('#applyRulesStatsSummary')).toContainText('Projected Auto-Applied');

    // Confirm execution
    await confirmModal.locator('#btnConfirmExecuteRules').click();
    await expect(confirmModal).not.toBeVisible();

    // Line 3 should now be resolved to Ignored by Rule 2 (Bank Monthly Maintenance Fees)
    await expect(line3Row.getByText('Ignored', { exact: true })).toBeVisible();

    // Now open Rules Engine to test Revert
    await page.click('#btnOpenReconciliationRules');
    const rulesModal = page.locator('#financeReconciliationRulesModal');
    await expect(rulesModal).toBeVisible();

    // Rule 2 should have revert button visible
    page.once('dialog', (dialog) => dialog.accept());
    const revertBtn = rulesModal.locator('#ruleRow_2 .btn-revert-rule');
    await expect(revertBtn).toBeVisible();
    await revertBtn.click();

    // Close rules modal
    await rulesModal.locator('.modal-close').click();

    // Line 3 should now be restored back to Unmatched
    await expect(line3Row.getByText('Unmatched', { exact: true })).toBeVisible();
  });
});
