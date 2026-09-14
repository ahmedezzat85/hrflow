import { test, expect } from '@playwright/test';

test.describe('Story 5.2: Guided Transaction Entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    await expect(page.locator('#financeSubPaneAccounts')).toBeVisible();

    // Open workspace on the first account
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click Record Transaction
    await page.click('#btnWorkspaceNewTx');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();
  });

  test('AC 1: Progressive entry type tabs toggle conditional fields correctly', async ({ page }) => {
    // 1. Default is Money Out
    await expect(page.locator('#fFinanceTxTypeMoneyOut')).toHaveClass(/active/);
    await expect(page.locator('#fFinanceTxCounterpartyGroup')).toBeVisible();
    await expect(page.locator('#fFinanceTxCounterpartyLabel')).toHaveText('Payee / Vendor');
    await expect(page.locator('#fFinanceTxTaxGroup')).toBeVisible();
    await expect(page.locator('#fFinanceTxDirectionGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxReasonGroup')).not.toBeVisible();

    // 2. Switch to Money In
    await page.click('#fFinanceTxTypeMoneyIn');
    await expect(page.locator('#fFinanceTxTypeMoneyIn')).toHaveClass(/active/);
    await expect(page.locator('#fFinanceTxCounterpartyGroup')).toBeVisible();
    await expect(page.locator('#fFinanceTxCounterpartyLabel')).toHaveText('Customer / Payer');
    await expect(page.locator('#fFinanceTxTaxGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxDirectionGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxReasonGroup')).not.toBeVisible();

    // 3. Switch to Bank Fee
    await page.click('#fFinanceTxTypeBankFee');
    await expect(page.locator('#fFinanceTxTypeBankFee')).toHaveClass(/active/);
    await expect(page.locator('#fFinanceTxCounterpartyGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxTaxGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxDirectionGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxReasonGroup')).not.toBeVisible();

    // 4. Switch to Adjustment
    await page.click('#fFinanceTxTypeAdjustment');
    await expect(page.locator('#fFinanceTxTypeAdjustment')).toHaveClass(/active/);
    await expect(page.locator('#fFinanceTxCounterpartyGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxTaxGroup')).not.toBeVisible();
    await expect(page.locator('#fFinanceTxDirectionGroup')).toBeVisible();
    await expect(page.locator('#fFinanceTxReasonGroup')).toBeVisible();
  });

  test('AC 2: Currency mismatch warning is displayed and blocks posting without FX rate', async ({ page }) => {
    // Active account is USD
    await expect(page.locator('#fFinanceTxCurrencyWarning')).not.toBeVisible();

    // Select foreign currency (e.g. EUR)
    await page.selectOption('#fFinanceTxCurrency', 'EUR');

    // Warning banner should be visible
    await expect(page.locator('#fFinanceTxCurrencyWarning')).toBeVisible();
    await expect(page.locator('#fFinanceTxCurrencyWarning')).toContainText('Currency Mismatch');

    // Enter amount without FX rate and try to save
    await page.fill('#fFinanceTxAmount', '150');
    await page.selectOption('#fFinanceTxCategory', { index: 1 });
    await page.click('#financeTxSaveBtn');

    // Toast error warning about explicit exchange rate
    await expect(page.locator('.toast')).toContainText('Foreign currency transaction');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();

    // Fill valid FX rate
    await page.fill('#fFinanceTxFxRate', '1.08');
  });

  test('AC 3: Preview describes financial effect in plain language and journal entries for adjustment', async ({ page }) => {
    // Default Money Out
    await page.fill('#fFinanceTxAmount', '250.00');

    // Wait for debounced preview
    const plainDesc = page.locator('#fFinanceTxPlainDesc');
    await expect(plainDesc).toContainText('decrease', { timeout: 3000 });
    await expect(plainDesc).toContainText('250.00');

    const badge = page.locator('#fFinanceTxProjectedBadge');
    await expect(badge).toContainText('Projected:');

    // Switch to Adjustment
    await page.click('#fFinanceTxTypeAdjustment');
    await page.fill('#fFinanceTxAmount', '500.00');

    // Journal preview table should become visible for adjustments
    await expect(page.locator('#fFinanceTxJournalWrapper')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#fFinanceTxJournalTbody tr')).toHaveCount(2);
  });

  test('AC 4: Manual adjustments require reason and record successfully', async ({ page }) => {
    // Switch to Adjustment
    await page.click('#fFinanceTxTypeAdjustment');
    await page.fill('#fFinanceTxAmount', '120.00');

    // Try saving without reason
    await page.click('#financeTxSaveBtn');
    await expect(page.locator('.toast')).toContainText('Adjustment reason is required');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();

    // Provide mandatory reason and save
    await page.fill('#fFinanceTxReason', 'Opening balance calibration per audited financials');
    await page.click('#financeTxSaveBtn');

    // Modal closes and success toast appears
    await expect(page.locator('#financeTransactionModal')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Transaction recorded successfully');
  });
});
