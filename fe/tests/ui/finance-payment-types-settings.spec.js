import { test, expect } from '@playwright/test';

test.describe('FUX-409: Payment Method Naming, Settings Integrity, and Bank Fee Auto-Fill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Standard banking/accounting names in Settings -> Payment Types', async ({ page }) => {
    // Navigate to Settings
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await expect(page.locator('#a-finance-settings')).toBeVisible();

    // Switch to Payment Types subtab
    await page.click('#subtabSettingsPaymentTypes');
    await expect(page.locator('#financeSettingsPanePaymentTypes')).toBeVisible();

    // Wait for rows to render within settings pane
    const tableBody = page.locator('#financeSettingsPanePaymentTypes #financePaymentTypesTableBody');
    await expect(tableBody.locator('tr')).not.toHaveCount(0, { timeout: 5000 });

    // Verify standardized names are rendered
    await expect(tableBody).toContainText('ATM Withdrawal');
    await expect(tableBody).toContainText('Check Payment');
    await expect(tableBody).toContainText('Internal Transfer');
    await expect(tableBody).toContainText('Incoming Transfer');
    await expect(tableBody).toContainText('Cash Payment');
    await expect(tableBody).toContainText('Debit Card Payment');
    await expect(tableBody).toContainText('Currency Exchange');
    await expect(tableBody).toContainText('Outgoing Transfer');
    await expect(tableBody).toContainText('Bank Fee');

    // Verify machine codes remain intact
    await expect(tableBody).toContainText('CASHWITHDRAW');
    await expect(tableBody).toContainText('CHK');
    await expect(tableBody).toContainText('BANK_FEES');
  });

  test('AC 2: Settings list integrity - error state displays visible banner on failure', async ({ page }) => {
    // Navigate to Settings
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await expect(page.locator('#a-finance-settings')).toBeVisible();

    // Switch to Payment Types subtab
    await page.click('#subtabSettingsPaymentTypes');
    await expect(page.locator('#financeSettingsPanePaymentTypes')).toBeVisible();

    // Inject failure into FinanceApi.getPaymentTypes
    await page.evaluate(() => {
      window.FinanceApi.getPaymentTypes = async () => {
        throw new Error('Database connection failed (500)');
      };
    });

    // Trigger reload
    await page.evaluate(() => window.loadFinancePaymentTypes());

    // Verify visible error banner is displayed
    const errorBanner = page.locator('#financeSettingsPanePaymentTypes #financePaymentTypesError');
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#financePaymentTypesErrorMessage')).toContainText('Database connection failed');
    await expect(page.locator('#financeSettingsPanePaymentTypes #financePaymentTypesEmpty')).not.toBeVisible();
    await expect(page.locator('#financeSettingsPanePaymentTypes #financePaymentTypesTableBody tr')).toHaveCount(0);
  });

  test('AC 3: Bank Fee guided-entry auto-fills payment method and hides the field', async ({ page }) => {
    // Navigate to Accounts
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Open workspace on the first account
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click Record Transaction
    await page.click('#btnWorkspaceNewTx');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();

    // Default is Money Out: Payment Method is visible
    const ptGroup = page.locator('#fFinanceTxPaymentTypeGroup');
    const ptSelect = page.locator('#fFinanceTxPaymentType');
    await expect(ptGroup).toBeVisible();

    // Switch to Bank Fee
    await page.click('#fFinanceTxTypeBankFee');
    await expect(page.locator('#fFinanceTxTypeBankFee')).toHaveClass(/active/);

    // Payment method group should be hidden
    await expect(ptGroup).not.toBeVisible();

    // Bank Fee payment type should be auto-filled behind the scenes
    const selectedPtValue = await ptSelect.inputValue();
    expect(selectedPtValue).not.toBe('');
    // The auto-selected payment type should correspond to BANK_FEES (id 9 in mock)
    const optionText = await page.locator(`#fFinanceTxPaymentType option[value="${selectedPtValue}"]`).textContent();
    expect(optionText).toContain('Bank Fee');

    // Switch back to Money Out
    await page.click('#fFinanceTxTypeMoneyOut');
    await expect(page.locator('#fFinanceTxTypeMoneyOut')).toHaveClass(/active/);

    // Payment method group should be restored
    await expect(ptGroup).toBeVisible();
    // Auto-filled Bank Fee value must be reset to avoid accidental stale leak
    const resetPtValue = await ptSelect.inputValue();
    expect(resetPtValue).toBe('');
  });

  test('AC 4: Create Bank Fee transaction end-to-end without interacting with payment method', async ({ page }) => {
    // Navigate to Accounts
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Open workspace on the first account
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click Record Transaction
    await page.click('#btnWorkspaceNewTx');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();

    // Select Bank Fee
    await page.click('#fFinanceTxTypeBankFee');
    await expect(page.locator('#fFinanceTxPaymentTypeGroup')).not.toBeVisible();

    // If Bank Fee category was auto-selected or select one if none
    const catVal = await page.locator('#fFinanceTxCategory').inputValue();
    if (!catVal) {
      await page.selectOption('#fFinanceTxCategory', { index: 1 });
    }

    // Enter Amount and Save without ever touching Payment Method
    await page.fill('#fFinanceTxAmount', '25.00');
    await page.click('#financeTxSaveBtn');

    // Transaction should record successfully and modal closes
    await expect(page.locator('#financeTransactionModal')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Transaction recorded successfully');
  });
});
