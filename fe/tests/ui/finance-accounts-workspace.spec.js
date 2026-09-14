import { test, expect } from '@playwright/test';

test.describe('Story 5.1: Account List and Account Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    await expect(page.locator('#financeSubPaneAccounts')).toBeVisible();
  });

  test('AC 1: Account list displays separated balances, masked identifiers, and opens workspace', async ({ page }) => {
    const table = page.locator('#financeAccountsTableBody');
    await expect(table).toBeVisible();

    // Verify row displays masked account identifier
    await expect(table).toContainText('******4821');

    // Verify table has columns for Book, Available, Reconciled
    await expect(page.locator('#financeSubPaneAccounts th:has-text("Book Balance")')).toBeVisible();
    await expect(page.locator('#financeSubPaneAccounts th:has-text("Available")')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Reconciled', exact: true })).toBeVisible();

    // Click Workspace button on the first account
    const wsBtn = page.locator('.btn-open-workspace').first();
    await expect(wsBtn).toBeVisible();
    await wsBtn.click();

    // Verify workspace pane is shown and account list is hidden
    await expect(page.locator('#financeSubPaneAccounts')).not.toBeVisible();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Context header shows account name and masked identifier
    await expect(page.locator('#workspaceAccountName')).toBeVisible();
    await expect(page.locator('#workspaceAccountIdentifier')).toContainText('******');

    // Back to accounts returns to list
    await page.click('#btnBackToAccounts');
    await expect(page.locator('#financeSubPaneAccounts')).toBeVisible();
    await expect(page.locator('#financeSubPaneWorkspace')).not.toBeVisible();
  });

  test('AC 1: Masked identifier by default and reveal permission toggle', async ({ page }) => {
    // Open workspace
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    const idEl = page.locator('#workspaceAccountIdentifier');
    const revealBtn = page.locator('#btnRevealAccountNumber');

    // Default masked
    await expect(idEl).toContainText('******4821');
    await expect(revealBtn).toContainText('Reveal');

    // Click reveal
    await revealBtn.click();

    // Identifier should now be unmasked
    await expect(idEl).toHaveText('12345678904821');
    await expect(revealBtn).toContainText('Conceal');

    // Click conceal
    await revealBtn.click();
    await expect(idEl).toContainText('******4821');
  });

  test('AC 2: 4 separated balance cards with definitions and as-of time', async ({ page }) => {
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Verify 4 Balance Cards
    await expect(page.locator('#workspaceBookBalance')).toBeVisible();
    await expect(page.locator('#workspaceBookBalanceAsOf')).toContainText('As of:');

    await expect(page.locator('#workspaceAvailableBalance')).toBeVisible();
    await expect(page.locator('#workspaceAvailableBalanceSub')).toContainText('Liquid balance immediately available');

    await expect(page.locator('#workspaceBankBalance')).toBeVisible();
    await expect(page.locator('#workspaceLastImportStatus')).toBeVisible();

    await expect(page.locator('#workspaceReconciledBalance')).toBeVisible();
    await expect(page.locator('#workspaceLastReconciledStatus')).toBeVisible();
  });

  test('AC 3: Permitted actions toolbar defaults to the active account', async ({ page }) => {
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click "Record Transaction" quick action in workspace header
    await page.click('#btnWorkspaceNewTx');
    const txModal = page.locator('#financeTransactionModal');
    await expect(txModal).toBeVisible();

    // The account selector/field should be pre-set to account 1
    const txAccountInput = page.locator('#fFinanceTxAccountId');
    await expect(txAccountInput).toHaveValue('1');

    await page.click('#financeTransactionModal .modal-close');
    await expect(txModal).not.toBeVisible();

    // Click "Transfer" quick action
    await page.click('#btnWorkspaceTransfer');
    const transferModal = page.locator('#financeTransferModal');
    await expect(transferModal).toBeVisible();

    // Source account dropdown should have account 1 pre-selected
    const fromSel = page.locator('#transferFromAccount');
    await expect(fromSel).toHaveValue('1');

    await page.click('#financeTransferModal .modal-close');
    await expect(transferModal).not.toBeVisible();
  });

  test('AC 4: Operational tabs vs Settings tab and currency lock after postings', async ({ page }) => {
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Activity tab active by default
    await expect(page.locator('#workspacePaneActivity')).toBeVisible();
    await expect(page.locator('#workspacePaneDetails')).not.toBeVisible();

    // Switch to Details & Settings tab
    await page.click('#tabWsDetails');
    await expect(page.locator('#workspacePaneDetails')).toBeVisible();
    await expect(page.locator('#workspacePaneActivity')).not.toBeVisible();

    // Account 1 has postings: Currency selector must be disabled and warning notice visible
    const currencySelect = page.locator('#wsSettingCurrency');
    await expect(currencySelect).toBeDisabled();
    await expect(page.locator('#wsSettingCurrencyLockNotice')).toBeVisible();

    // Switch to Reconcile tab
    await page.click('#tabWsReconcile');
    await expect(page.locator('#workspacePaneReconcile')).toBeVisible();
    await expect(page.locator('#workspacePaneDetails')).not.toBeVisible();

    // Switch to Statements tab
    await page.click('#tabWsStatements');
    await expect(page.locator('#workspacePaneStatements')).toBeVisible();
    await expect(page.locator('#workspacePaneReconcile')).not.toBeVisible();
  });
});
