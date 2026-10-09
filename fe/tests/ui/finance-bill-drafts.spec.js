import { test, expect } from '@playwright/test';
import { confirmDialog } from './helpers/confirm.js';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Vendor Bill Workflow v2 (B4) — drafts and multi-file upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('Several files at once become one Draft each, with unmatched vendors flagged "Vendor to confirm"', async ({ page }) => {
    await page.setInputFiles('#financeBillsUploadInput', [
      { name: 'Amazon_Web_Services_oct.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') },
      { name: 'Slack_invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 b') },
      { name: 'mystery_shop_receipt.png', mimeType: 'image/png', buffer: Buffer.from('png') },
    ]);

    // The list opens filtered to Drafts and shows the three new drafts
    await expect(page.locator('#tabBillQueueDraft')).toHaveAttribute('aria-selected', 'true');
    const rows = page.locator('#financeBillsTableBody tr');
    await expect(rows.filter({ hasText: 'Amazon Web Services' }).filter({ hasText: '(no number yet)' })).toHaveCount(1);
    const unmatched = rows.filter({ hasText: 'Vendor to confirm' });
    await expect(unmatched).toHaveCount(1);
    await expect(unmatched).toContainText('mystery_shop_receipt');
  });

  test('A draft can be discarded; other bills have no discard action', async ({ page }) => {
    // BILL-2026-003 is a draft in the mock data
    await page.evaluate(() => setBillWorkQueue('draft'));
    const draftRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    await expect(draftRow).toBeVisible();
    await expect(draftRow.locator('button.btn-discard-draft')).toHaveCount(0); // not a row action
    await draftRow.locator('.btn-bill-more').click();
    await draftRow.locator('button.btn-view-bill').click();
    await expect(page.locator('#financeDetailDrawerOverlay')).toBeVisible();
    await page.locator('button.btn-drawer-discard').click();
    await confirmDialog(page);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toHaveCount(0);

    // An approved bill offers Void, never Discard
    await page.evaluate(() => setBillWorkQueue('approved'));
    const approvedRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(approvedRow).toBeVisible();
    await approvedRow.locator('.btn-bill-more').click();
    await approvedRow.locator('button.btn-view-bill').click();
    await expect(page.locator('button.btn-drawer-void')).toBeVisible();
    await expect(page.locator('button.btn-drawer-discard')).toHaveCount(0);
  });
});
