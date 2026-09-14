import { test, expect } from '@playwright/test';

test.describe('Story 5.3: Transfer and Withdrawal Composer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Open Transfer Modal
    await page.click('button:has-text("Record Transfer")');
    await expect(page.locator('#financeTransferModal')).toBeVisible();
  });

  test('AC 1: User cannot create a transfer from an account to itself', async ({ page }) => {
    const fromSel = page.locator('#transferFromAccount');
    const toSel = page.locator('#transferToAccount');
    const saveBtn = page.locator('#btnSaveFinanceTransfer');
    const sameAlert = page.locator('#transferSameAccountAlert');

    // Select first account for source
    await fromSel.selectOption({ index: 1 });
    const fromVal = await fromSel.inputValue();

    // Select the EXACT same account for target
    await toSel.selectOption(fromVal);

    // Alert should appear and submit button should be disabled
    await expect(sameAlert).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // Selecting a different account resolves the error
    await toSel.selectOption({ index: 2 });
    await expect(sameAlert).not.toBeVisible();
    await expect(saveBtn).not.toBeDisabled();
  });

  test('AC 2: FX direction, 3-way calculation, and both resulting amounts are unambiguous', async ({ page }) => {
    const fromSel = page.locator('#transferFromAccount');
    const toSel = page.locator('#transferToAccount');

    // Select USD account (index 1) and EGP account (index 3)
    await fromSel.selectOption({ index: 1 });
    await toSel.selectOption({ index: 3 });

    // Mode auto-switches to Same-Bank FX and FX section appears
    await expect(page.locator('#transferFxSection')).toBeVisible();

    // Enter Outflow amount 1000 and FX rate 48.50
    await page.fill('#transferFromAmount', '1000');
    await page.fill('#transferFxRate', '48.50');

    // Inflow amount should automatically calculate to 48500.00
    const toAmtInput = page.locator('#transferToAmount');
    await expect(toAmtInput).toHaveValue('48500.00');

    // Explicit FX direction banner displays unambiguous rates
    await expect(page.locator('#transferFxDirectionText')).toContainText('1 USD = 48.5000 EGP');
    await expect(page.locator('#transferImpliedRateText')).toContainText('Implied Rate: 48.5000');

    // Live preview displays projected balances for both accounts
    await expect(page.locator('#transferFromProjectedHint')).not.toHaveText('—');
    await expect(page.locator('#transferToProjectedHint')).not.toHaveText('—');

    // Journal preview table displays dual-leg entries
    await expect(page.locator('#transferJournalWrapper')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#transferJournalTbody tr')).toHaveCount(2);
  });

  test('AC 3: Both legs post atomically for internal transfers', async ({ page }) => {
    const fromSel = page.locator('#transferFromAccount');
    const toSel = page.locator('#transferToAccount');

    // Select USD account (index 1) and USD Savings (index 2)
    await fromSel.selectOption({ index: 1 });
    await toSel.selectOption({ index: 2 });

    await page.fill('#transferFromAmount', '500');

    // Inflow amount auto-matches
    await expect(page.locator('#transferToAmount')).toHaveValue('500.00');

    // Post transfer
    await page.click('#btnSaveFinanceTransfer');

    // Modal closes and success toast appears
    await expect(page.locator('#financeTransferModal')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Transfer posted successfully');
  });

  test('AC 4: In-transit transfers display in-transit settlement state and preview', async ({ page }) => {
    // Switch to External In-Transit
    await page.click('label[for="transferTypeExternalLinked"]');

    // External guidance group appears
    await expect(page.locator('#transferExternalGroup')).toBeVisible();

    // Select source account
    await page.locator('#transferFromAccount').selectOption({ index: 1 });
    await page.fill('#transferFromAmount', '1250');

    // Settlement action defaults to Outflow In-Transit
    await page.selectOption('#transferConfirmedLeg', 'from_only');

    // Review badge displays In Transit state
    await expect(page.locator('#transferSettlementBadge')).toContainText('In Transit');

    // Post in-transit transfer
    await page.click('#btnSaveFinanceTransfer');
    await expect(page.locator('#financeTransferModal')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Transfer posted successfully');
  });
});
