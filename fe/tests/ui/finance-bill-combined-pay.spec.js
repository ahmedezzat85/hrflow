import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Story FUX-408 — Combined create-and-pay bill action with settlement-status integrity guard', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills section
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1 & 2: A super admin records a paid cash bill in one save, typing only vendor, number, category and amount', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Super admin gets the "Not paid yet / Already paid" choice, starting on Not paid yet
    await expect(page.locator('#billIsPaidNowGroup')).toBeVisible();
    await expect(page.locator('#billPaidChoiceNo')).toBeChecked();
    await expect(page.locator('#billPaidNowSection')).not.toBeVisible();
    await expect(page.locator('#billSavesAsLine')).toContainText('Approved');

    // Defaults: currency EGP; line items are optional
    await expect(page.locator('#billCurrency')).toHaveValue('EGP');
    await page.selectOption('#billVendorId', { index: 1 });
    await page.fill('#billNumber', 'BILL-FUX408-001');
    await page.selectOption('#billCategoryId', { label: 'Infrastructure' });
    await page.fill('#billAmount', '450');

    // Already paid: the cash account in the bill currency and Cash payment are the defaults
    await page.check('#billPaidChoiceYes');
    await expect(page.locator('#billPaidNowSection')).toBeVisible();
    await expect(page.locator('#billSavesAsLine')).toContainText('Paid');
    await expect(page.locator('#billPaidNowAmount')).toHaveValue('450.00');
    await expect(page.locator('#billPaidNowBankAccountId option:checked')).toContainText('Petty Cash');
    await expect(page.locator('#billPaidNowTypeId option:checked')).toContainText('Cash');
    await expect(page.locator('#billPaidNowReference')).toHaveValue('');

    // One save
    await page.click('#billModalSaveBtn');
    await expect(page.locator('#billModal')).not.toBeVisible();

    const createdRow = page.locator('#financeBillsTableBody tr:has-text("BILL-FUX408-001")');
    await expect(createdRow).toBeVisible();
    await expect(createdRow.locator('.status-badge-wrap')).toContainText('Paid');

    // The choice is remembered for next time
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billPaidChoiceYes')).toBeChecked();
    await page.click('#billModal .modal-close');
  });

  test('A finance user sees no payment fields and the primary action is Submit for approval', async ({ page }) => {
    await page.goto('/?mock=finance');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();
    await expect(page.locator('#billIsPaidNowGroup')).not.toBeVisible();
    await expect(page.locator('#billPaidNowSection')).not.toBeVisible();
    await expect(page.locator('#billModalSaveBtn')).toContainText('Submit for approval');
    await expect(page.locator('#billSavesAsLine')).toContainText('Pending Approval');
    await expect(page.locator('#billSaveDraftBtn')).toBeVisible();

    await page.selectOption('#billVendorId', { index: 1 });
    await page.fill('#billNumber', 'BILL-FIN-SUBMIT-1');
    await page.selectOption('#billCategoryId', { label: 'Infrastructure' });
    await page.fill('#billAmount', '75');
    await page.click('#billModalSaveBtn');
    await expect(page.locator('#billModal')).not.toBeVisible();
    await page.evaluate(() => setBillWorkQueue('pending_approval'));
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-FIN-SUBMIT-1")');
    await expect(row).toBeVisible();
    // and cannot approve it
    await expect(row.locator('button.btn-approve-bill')).toHaveCount(0);
  });

  test('AC 3: The bill form has no status dropdown; status is a read-only badge', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    await expect(page.locator('#billStatus')).toHaveCount(0);
    await expect(page.locator('#billStatusReadOnlyBadge')).toHaveText('Approved');

    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 4: Editing an already settled bill shows status as read-only badge and hides "Bill is already paid" checkbox', async ({ page }) => {
    // Find existing paid bill BILL-2026-002
    const paidRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")');
    await expect(paidRow).toBeVisible();

    // Click edit button (button with fa-pen icon)
    await paidRow.locator('button:has(.fa-pen)').click();
    await expect(page.locator('#billModal')).toBeVisible();

    // Check that "Bill is already paid" group is hidden in edit mode
    await expect(page.locator('#billIsPaidNowGroup')).not.toBeVisible();

    // Check that there is no editable status dropdown and the read-only status badge is visible
    await expect(page.locator('#billStatus')).toHaveCount(0);
    await expect(page.locator('#billStatusReadOnlyContainer')).toBeVisible();
    await expect(page.locator('#billStatusReadOnlyBadge')).toHaveText('Paid');

    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 5: Mock mode refuses any client-supplied status on create', async ({ page }) => {
    const errorMsg = await page.evaluate(async () => {
      try {
        await window.FinanceApi.createBill({
          vendor_id: 1,
          bill_number: 'BILL-ILLEGAL-01',
          issue_date: '2026-03-01',
          due_date: '2026-03-31',
          status: 'paid',
          lines: [{ description: 'Fake', quantity: 1, unit_price: 100, line_total: 100 }],
        });
        return null;
      } catch (err) {
        return err.message;
      }
    });

    expect(errorMsg).toContain('status cannot be set by the client');
  });
});
