import { test, expect } from '@playwright/test';

test.describe('Story 5.4: Cheque Lifecycle and Register', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Accounts workspace
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Switch to Cheque Register subtab
    await page.click('#subtabFinanceCheques');
    await expect(page.locator('#financeSubPaneCheques')).toBeVisible();
  });

  test('AC 1: Conditional fields toggle accurately based on purpose type', async ({ page }) => {
    // Open Issue Cheque Modal
    await page.click('button:has-text("Issue Cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();

    const purposeSel = page.locator('#chequePurposeType');
    const destCashGroup = page.locator('#chequeDestCashGroup');
    const linkedBillGroup = page.locator('#chequeLinkedBillGroup');

    // Default 'other': both conditional fields hidden
    await expect(destCashGroup).not.toBeVisible();
    await expect(linkedBillGroup).not.toBeVisible();

    // Select Cash Withdrawal: cash drawer group appears
    await purposeSel.selectOption('cash_withdrawal');
    await expect(destCashGroup).toBeVisible();
    await expect(linkedBillGroup).not.toBeVisible();

    // Select Vendor Payment: vendor bill group appears
    await purposeSel.selectOption('vendor_payment');
    await expect(destCashGroup).not.toBeVisible();
    await expect(linkedBillGroup).toBeVisible();

    // Cancel modal
    await page.click('#financeChequeModal button:has-text("Cancel")');
    await expect(page.locator('#financeChequeModal')).not.toBeVisible();
  });

  test('AC 2: Duplicate cheque number per account displays immediate warning', async ({ page }) => {
    await page.click('button:has-text("Issue Cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();

    // Select first bank account
    const bankSel = page.locator('#chequeAccountId');
    await bankSel.selectOption({ index: 1 });

    // In mock data, Cheque #001011 exists for account 1
    const chequeNumInput = page.locator('#chequeNumber');
    const dupWarn = page.locator('#chequeDuplicateWarning');

    await chequeNumInput.fill('001011');
    await expect(dupWarn).toBeVisible();

    // Change cheque number to something unique
    await chequeNumInput.fill('999999');
    await expect(dupWarn).not.toBeVisible();

    await page.click('#financeChequeModal button:has-text("Cancel")');
  });

  test('AC 3: Stale date warning appears when issue date is older than 180 days', async ({ page }) => {
    await page.click('button:has-text("Issue Cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();

    const issueDateInput = page.locator('#chequeIssueDate');
    const staleBanner = page.locator('#chequeStaleWarningBanner');

    // Date from 250 days ago
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 250);
    const dateStr = pastDate.toISOString().split('T')[0];

    await issueDateInput.fill(dateStr);
    await issueDateInput.evaluate((el) => el.dispatchEvent(new Event('change')));

    await expect(staleBanner).toBeVisible();
    await expect(page.locator('#chequeStaleWarningText')).toContainText('exceeding the standard 180-day');

    // Recent date clears warning
    const todayStr = new Date().toISOString().split('T')[0];
    await issueDateInput.fill(todayStr);
    await issueDateInput.evaluate((el) => el.dispatchEvent(new Event('change')));
    await expect(staleBanner).not.toBeVisible();

    await page.click('#financeChequeModal button:has-text("Cancel")');
  });

  test('AC 4: Draft saving, issuance, and exception action workflow', async ({ page }) => {
    // 1. Save Cheque as Draft
    await page.click('button:has-text("Issue Cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();

    await page.locator('#chequeAccountId').selectOption({ index: 1 });
    await page.locator('#chequeNumber').fill('CHK-DFT-88');
    await page.locator('#chequeAmount').fill('3400');
    await page.locator('#chequePayee').fill('Draft Supplier LLC');

    // Click "Save as Draft"
    await page.click('#chequeSaveDraftBtn');
    await expect(page.locator('#financeChequeModal')).not.toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Cheque draft saved successfully');

    // Cheque row with Draft status exists in table
    const tableBody = page.locator('#financeChequesTableBody');
    await expect(tableBody).toContainText('CHK-DFT-88');
    await expect(tableBody).toContainText('Draft Supplier LLC');

    // 2. Filter by Draft status tab
    await page.click('#financeChequeStatusTabs button[data-status="draft"]');
    await expect(tableBody).toContainText('CHK-DFT-88');

    // 3. Issue the draft cheque directly from table action
    const draftRow = tableBody.locator('tr:has-text("CHK-DFT-88")');
    await draftRow.locator('button:has-text("Issue")').click();
    await expect(page.locator('.toast').last()).toContainText('Cheque status updated to ISSUED');

    // 4. Switch to All tab to locate row and open exception modal
    await page.click('#financeChequeStatusTabs button[data-status=""]');
    const issuedRow = tableBody.locator('tr:has-text("CHK-DFT-88")');
    await expect(issuedRow).toBeVisible();

    // Click Stop payment button
    await issuedRow.locator('button[title="Stop Payment"]').click();
    await expect(page.locator('#financeChequeActionModal')).toBeVisible();
    await expect(page.locator('#chequeActionModalTitle')).toHaveText('Stop Payment on Cheque');

    // Fill mandatory reason and confirm
    await page.locator('#chequeActionReason').fill('Customer reported lost cheque in transit');
    await page.locator('#chequeActionEvidence').fill('Notice #STOP-442');
    await page.click('#chequeActionConfirmBtn');

    await expect(page.locator('#financeChequeActionModal')).not.toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Cheque marked as STOPPED');

    // 5. Replace the stopped cheque
    const stoppedRow = tableBody.locator('tr:has-text("CHK-DFT-88")');
    await stoppedRow.locator('button:has-text("Replace")').click();
    await expect(page.locator('#financeChequeReplaceModal')).toBeVisible();

    await page.locator('#replaceNewChequeNumber').fill('CHK-REP-89');
    await page.locator('#replaceReason').fill('Issuing replacement leaf for lost cheque');
    await page.locator('#replaceEvidence').fill('Notice #STOP-442');
    await page.click('#replaceConfirmBtn');

    await expect(page.locator('#financeChequeReplaceModal')).not.toBeVisible();
    await expect(page.locator('.toast').last()).toContainText('Replacement Cheque #CHK-REP-89 issued successfully');

    // Check bidirectional linkage in table
    await expect(tableBody).toContainText('CHK-REP-89');
    await expect(tableBody).toContainText('Replaced by');
  });
});
