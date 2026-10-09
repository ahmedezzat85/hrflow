import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Vendor Bill Workflow v2 (B2) — approve and pay permissions', () => {
  test('Financial-Admin without approve/pay sees no Approve or Pay buttons and saves new bills as Draft', async ({ page }) => {
    await page.goto('/?mock=finance');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    // BILL-2026-005 is Pending approval: no Approve button for a user without finance.bill.approve
    const pending = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")');
    await expect(pending).toBeVisible();
    await expect(pending.locator('button.btn-approve-bill')).toHaveCount(0);

    // BILL-2026-001 is Approved: Schedule is available (write), Pay is not (finance.bill.pay)
    const approved = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(approved.locator('button.btn-schedule-bill')).toBeVisible();
    await expect(approved.locator('button.btn-pay-bill')).toHaveCount(0);

    // New bills start as Draft for this user
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();
    await expect(page.locator('#billStatusReadOnlyBadge')).toHaveText('Draft');
    await page.click('#billModal .modal-close');
  });

  test('Super admin sees Approve and Pay actions', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005") button.btn-approve-bill')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001") button.btn-pay-bill')).toBeVisible();
  });
});
