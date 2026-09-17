import { test, expect } from '@playwright/test';

test.describe('FUX-505: Global Quick-Add Transaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Topbar button opens global quick-add modal with account selector', async ({ page }) => {
    // Navigate to a non-account page, e.g. Invoices or Reports
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Verify topbar Add Transaction button exists
    const quickAddBtn = page.locator('#adminQuickAddTxBtn');
    await expect(quickAddBtn).toBeVisible();
    await quickAddBtn.click();

    // Verify modal is open with global quick-add title and elements
    const modal = page.locator('#financeTransactionModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#financeTransactionModalTitle')).toHaveText('Quick-Add Transaction');

    // Account select group must be visible in global mode
    await expect(page.locator('#fFinanceTxAccountSelectGroup')).toBeVisible();
    const accountSelect = page.locator('#fFinanceTxAccountSelect');
    await expect(accountSelect).toBeVisible();

    // Save & Add Another button must be visible in footer
    const saveAndNewBtn = page.locator('#financeTxSaveAndNewBtn');
    await expect(saveAndNewBtn).toBeVisible();
    await expect(saveAndNewBtn).toContainText('Save & Add Another');

    // Close modal
    await page.locator('#financeTransactionModal .modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('Command palette and Shift+N keyboard shortcut open global quick-add modal', async ({ page }) => {
    // 1. Test Command Palette
    await page.click('#adminSearchBtn');
    const paletteModal = page.locator('#commandPaletteModal');
    await expect(paletteModal).toBeVisible();

    await page.fill('#commandPaletteInput', 'quick');
    const actionItem = page.locator('#commandPaletteResults .palette-item').first();
    await expect(actionItem).toBeVisible();
    await expect(actionItem).toContainText('Record Transaction');
    await actionItem.click();

    await expect(paletteModal).not.toBeVisible();
    const modal = page.locator('#financeTransactionModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#financeTransactionModalTitle')).toHaveText('Quick-Add Transaction');

    // Close modal
    await page.locator('#financeTransactionModal .modal-close').click();
    await expect(modal).not.toBeVisible();

    // 2. Test Shift+N keyboard shortcut
    await page.keyboard.press('Shift+KeyN');
    await expect(modal).toBeVisible();
    await expect(page.locator('#financeTransactionModalTitle')).toHaveText('Quick-Add Transaction');

    await page.locator('#financeTransactionModal .modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('Requires bank account selection before posting in global mode', async ({ page }) => {
    await page.click('#adminQuickAddTxBtn');
    const modal = page.locator('#financeTransactionModal');
    await expect(modal).toBeVisible();

    // Ensure account select is on empty placeholder
    await page.selectOption('#fFinanceTxAccountSelect', '');

    // Fill valid amount and category
    await page.fill('#fFinanceTxAmount', '50.00');
    await page.selectOption('#fFinanceTxCategory', { index: 1 });

    // Click Save
    await page.click('#financeTxSaveBtn');

    // Should display validation toast
    await expect(page.locator('.toast')).toContainText('Please select a bank account');
    await expect(modal).toBeVisible();

    // Now select a valid account
    await page.selectOption('#fFinanceTxAccountSelect', { index: 1 });

    // Active account context should reflect account name
    const accName = await page.locator('#fFinanceTxAccountName').textContent();
    expect(accName).not.toBe('Select Account');
    expect(accName.length).toBeGreaterThan(0);

    // Context balance should be populated
    const accBal = await page.locator('#fFinanceTxAccountBookBalance').textContent();
    expect(accBal).not.toBe('—');

    await page.locator('#financeTransactionModal .modal-close').click();
  });

  test('Save & add another retains account and context while clearing entry fields for sequential recording', async ({ page }) => {
    await page.click('#adminQuickAddTxBtn');
    const modal = page.locator('#financeTransactionModal');
    await expect(modal).toBeVisible();

    // Select account
    await page.selectOption('#fFinanceTxAccountSelect', { index: 1 });
    const selectedAccountVal = await page.locator('#fFinanceTxAccountSelect').inputValue();
    const selectedDate = await page.locator('#fFinanceTxDate').inputValue();

    // First entry
    await page.fill('#fFinanceTxAmount', '45.00');
    await page.selectOption('#fFinanceTxCategory', { index: 1 });
    await page.fill('#fFinanceTxCounterparty', 'Office Supplies Depot');
    await page.fill('#fFinanceTxReference', 'REF-ENTRY-1');

    // Click Save & Add Another
    await page.click('#financeTxSaveAndNewBtn');

    // Modal remains visible and success toast appears
    await expect(modal).toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Transaction recorded successfully');

    // Check that entry fields are cleared
    await expect(page.locator('#fFinanceTxAmount')).toHaveValue('');
    await expect(page.locator('#fFinanceTxCounterparty')).toHaveValue('');
    await expect(page.locator('#fFinanceTxReference')).toHaveValue('');

    // Check that account selection, date, and type are retained
    await expect(page.locator('#fFinanceTxAccountSelect')).toHaveValue(selectedAccountVal);
    await expect(page.locator('#fFinanceTxDate')).toHaveValue(selectedDate);
    await expect(page.locator('#fFinanceTxTypeMoneyOut')).toHaveClass(/active/);

    // Second entry
    await page.fill('#fFinanceTxAmount', '85.50');
    await page.selectOption('#fFinanceTxCategory', { index: 1 });
    await page.fill('#fFinanceTxCounterparty', 'Cloud Hosting Services');
    await page.fill('#fFinanceTxReference', 'REF-ENTRY-2');

    // Click standard Save Transaction
    await page.click('#financeTxSaveBtn');

    // Modal closes and success toast appears
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Transaction recorded successfully');
  });

  test('Workspace-scoped "Record Transaction" retains account lock and hides global account selector', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Open workspace on first account
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click Record Transaction from workspace
    await page.click('#btnWorkspaceNewTx');
    const modal = page.locator('#financeTransactionModal');
    await expect(modal).toBeVisible();

    // Title should be "Record Transaction"
    await expect(page.locator('#financeTransactionModalTitle')).toHaveText('Record Transaction');

    // Global account select group must NOT be visible
    await expect(page.locator('#fFinanceTxAccountSelectGroup')).not.toBeVisible();

    // Active account context banner is visible and locked
    await expect(page.locator('#fFinanceTxAccountContext')).toBeVisible();
    const accName = await page.locator('#fFinanceTxAccountName').textContent();
    expect(accName.length).toBeGreaterThan(0);
    expect(accName).not.toBe('Select Account');

    // Save & Add Another is still available in workspace entry
    await expect(page.locator('#financeTxSaveAndNewBtn')).toBeVisible();

    await page.locator('#financeTransactionModal .modal-close').click();
  });
});
