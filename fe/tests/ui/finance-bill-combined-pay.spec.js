import { test, expect } from '@playwright/test';

test.describe('Story FUX-408 — Combined create-and-pay bill action with settlement-status integrity guard', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills section
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1 & 2: Checkbox "Bill is already paid" reveals payment fields and creates fully settled bill atomically', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Verify "Bill is already paid" group is visible in create mode
    const paidNowGroup = page.locator('#billIsPaidNowGroup');
    await expect(paidNowGroup).toBeVisible();
    const paidNowCheckbox = page.locator('#billIsPaidNow');
    await expect(paidNowCheckbox).not.toBeChecked();

    const paidNowSection = page.locator('#billPaidNowSection');
    await expect(paidNowSection).not.toBeVisible();

    // Fill standard bill fields
    await page.selectOption('#billVendorId', { index: 1 });
    await page.fill('#billNumber', 'BILL-FUX408-001');
    await page.selectOption('#billDepartment', 'Engineering');
    await page.fill('#billCategory', 'Cloud Services');
    await page.fill('#billIssueDate', '2026-03-10');
    await page.fill('#billDueDate', '2026-03-31');

    // Fill line item: $450.00
    const firstLineDesc = page.locator('#billLinesBody tr input[type="text"]').first();
    await firstLineDesc.fill('Kubernetes Cluster');
    const firstLinePrice = page.locator('#billLinesBody tr input.bill-price').first();
    await firstLinePrice.fill('450');
    await firstLinePrice.dispatchEvent('input');

    await expect(page.locator('#billTotalDisplay')).toHaveText('450.00');

    // Check "Bill is already paid"
    await paidNowCheckbox.check();
    await expect(paidNowSection).toBeVisible();

    // Verify payment amount defaults to 450.00
    const amtInput = page.locator('#billPaidNowAmount');
    await expect(amtInput).toHaveValue('450.00');

    // Select bank account
    const accSelect = page.locator('#billPaidNowBankAccountId');
    await expect(accSelect.locator('option')).not.toHaveCount(1);
    await accSelect.selectOption({ index: 1 });

    // Save Bill
    await page.click('#billModalSaveBtn');
    await expect(page.locator('#billModal')).not.toBeVisible();

    // Verify created bill appears in table with Paid badge
    const createdRow = page.locator('#financeBillsTableBody tr:has-text("BILL-FUX408-001")');
    await expect(createdRow).toBeVisible();
    await expect(createdRow.locator('.status-badge-wrap')).toContainText('Paid');
  });

  test('AC 3: Bill Status dropdown does not offer Paid or Partially Paid as directly selectable options', async ({ page }) => {
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    const statusOptions = await page.locator('#billStatus option').allTextContents();
    expect(statusOptions).not.toContain('Paid');
    expect(statusOptions).not.toContain('Partially Paid');

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

    // Check that editable status dropdown is hidden and read-only status badge is visible
    await expect(page.locator('#billStatus')).not.toBeVisible();
    await expect(page.locator('#billStatusReadOnlyContainer')).toBeVisible();
    await expect(page.locator('#billStatusReadOnlyBadge')).toHaveText('Paid');

    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 5: Server-side integrity guard in mock mode blocks direct status="paid" without is_paid_now', async ({ page }) => {
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

    expect(errorMsg).toContain('Paid or partially paid status cannot be set directly');
  });
});
