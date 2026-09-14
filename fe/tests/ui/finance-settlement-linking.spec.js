import { test, expect } from '@playwright/test';

test.describe('FUX-406: Unified Settlement Linking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    await expect(page.locator('#financeSubPaneAccounts')).toBeVisible();

    // Open workspace on the first account (Voyance Operating USD)
    await page.locator('.btn-open-workspace').first().click();
    await expect(page.locator('#financeSubPaneWorkspace')).toBeVisible();

    // Click Record Transaction
    await page.click('#btnWorkspaceNewTx');
    await expect(page.locator('#financeTransactionModal')).toBeVisible();
  });

  test('AC 1: Selecting a vendor surfaces open bills; selecting bill auto-fills amount, currency, and reference', async ({ page }) => {
    // 1. Select Payee Type: Vendor
    await page.selectOption('#fFinanceTxPayeeType', 'vendor');
    await expect(page.locator('#fFinanceTxVendorGroup')).toBeVisible();

    // 2. Select Vendor: Amazon Web Services (ID: 1)
    await page.selectOption('#fFinanceTxVendorId', '1');

    // 3. Open bills dropdown should become visible with open bills
    const linkedBillGroup = page.locator('#fFinanceTxLinkedBillGroup');
    await expect(linkedBillGroup).toBeVisible();

    const linkedBillSelect = page.locator('#fFinanceTxLinkedBillId');
    await expect(linkedBillSelect).toBeVisible();
    await expect(linkedBillSelect.locator('option')).toContainText(['BILL-2026-001']);

    // 4. Select Bill BILL-2026-001 (ID: 1, $4200.00)
    await linkedBillSelect.selectOption('1');

    // 5. Amount, Reference, and Currency should be auto-filled
    await expect(page.locator('#fFinanceTxAmount')).toHaveValue('4200.00');
    await expect(page.locator('#fFinanceTxReference')).toHaveValue('BILL-2026-001');
    await expect(page.locator('#fFinanceTxCurrency')).toHaveValue('USD');

    // 6. Select category and save transaction
    await page.selectOption('#fFinanceTxCategory', { index: 1 });
    await page.click('#financeTxSaveBtn');

    // Modal should close and success toast should appear
    await expect(page.locator('.toast')).toContainText('Transaction recorded successfully');
    await expect(page.locator('#financeTransactionModal')).not.toBeVisible();
  });

  test('AC 2: Duplicate settlement warning appears when amount closely matches open bill, Link button links it', async ({ page }) => {
    // 1. Select Payee Type: Vendor -> Amazon Web Services
    await page.selectOption('#fFinanceTxPayeeType', 'vendor');
    await page.selectOption('#fFinanceTxVendorId', '1');
    await expect(page.locator('#fFinanceTxLinkedBillGroup')).toBeVisible();

    // 2. Leave linked bill unselected ("No specific bill")
    await page.selectOption('#fFinanceTxLinkedBillId', '');

    // 3. Type amount matching BILL-2026-001 ($4200)
    await page.fill('#fFinanceTxAmount', '4200.00');

    // 4. Duplicate settlement warning banner should appear
    const warnBanner = page.locator('#fFinanceTxDuplicateWarning');
    await expect(warnBanner).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#fFinanceTxDuplicateWarningText')).toContainText('BILL-2026-001');

    // 5. Click "Link to Bill" action in banner
    const actionBtn = page.locator('#fFinanceTxDuplicateActionBtn');
    await expect(actionBtn).toHaveText('Link to Bill');
    await actionBtn.click();

    // 6. Banner disappears and linked bill is selected
    await expect(warnBanner).not.toBeVisible();
    await expect(page.locator('#fFinanceTxLinkedBillId')).toHaveValue('1');
    await expect(page.locator('#fFinanceTxReference')).toHaveValue('BILL-2026-001');
  });

  test('AC 3: Dismiss button on duplicate warning banner hides the warning', async ({ page }) => {
    await page.selectOption('#fFinanceTxPayeeType', 'vendor');
    await page.selectOption('#fFinanceTxVendorId', '1');
    await page.selectOption('#fFinanceTxLinkedBillId', '');

    // Enter amount matching bill
    await page.fill('#fFinanceTxAmount', '4200.00');

    const warnBanner = page.locator('#fFinanceTxDuplicateWarning');
    await expect(warnBanner).toBeVisible({ timeout: 4000 });

    // Click Dismiss
    await page.click('#fFinanceTxDuplicateWarning button:has-text("Dismiss")');
    await expect(warnBanner).not.toBeVisible();
  });

  test('AC 4: Customer selection surfaces open invoices for Money In; auto-fills balance and reference', async ({ page }) => {
    // 1. Switch to Money In
    await page.click('#fFinanceTxTypeMoneyIn');

    // 2. Payee type defaults to customer, customer group is visible
    await expect(page.locator('#fFinanceTxCustomerGroup')).toBeVisible();

    // 3. Select Customer: Apex Health Partners (ID: 1)
    await page.selectOption('#fFinanceTxCustomerId', '1');

    // 4. Linked invoice group should become visible with open invoice INV-2026-001 ($12500.00)
    const linkedInvoiceGroup = page.locator('#fFinanceTxLinkedInvoiceGroup');
    await expect(linkedInvoiceGroup).toBeVisible();

    const linkedInvoiceSelect = page.locator('#fFinanceTxLinkedInvoiceId');
    await expect(linkedInvoiceSelect.locator('option')).toContainText(['INV-2026-001']);

    // 5. Select invoice INV-2026-001 (ID: 1, $12500.00)
    await linkedInvoiceSelect.selectOption('1');

    // 6. Amount and Reference should be auto-filled
    await expect(page.locator('#fFinanceTxAmount')).toHaveValue('12500.00');
    await expect(page.locator('#fFinanceTxReference')).toHaveValue('INV-2026-001');

    // 7. Select category and save transaction
    await page.selectOption('#fFinanceTxCategory', { index: 1 });
    await page.click('#financeTxSaveBtn');

    await expect(page.locator('.toast')).toContainText('Transaction recorded successfully');
    await expect(page.locator('#financeTransactionModal')).not.toBeVisible();
  });
});
