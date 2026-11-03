import { test, expect } from '@playwright/test';

// Import review: a person accepts, edits or rejects leave that was staged from old emails and scans.
async function openReview(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof showSection === 'function' && typeof renderHistoryImport === 'function');
  await page.evaluate(() => showSection('a-history-import', 'admin'));
  await expect(page.locator('#hiItemsBody tr').first()).toBeVisible();
  // Newest batch first; the tests below start from the oldest one
  await page.selectOption('#hiBatchSelect', '1');
  await expect(page.locator('#hiItemsBody tr:has-text("Ahmed Hassan")')).toBeVisible();
}

test.describe('Import review', () => {
  test('opens from the Vacations page and lists the first batch waiting for review', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() => typeof showSection === 'function');
    await page.evaluate(() => showSection('a-vacations', 'admin'));
    await page.locator('#btnOpenHistoryImport').click();
    await expect(page.locator('#a-history-import')).toBeVisible();
    await page.selectOption('#hiBatchSelect', '1');
    await expect(page.locator('#hiItemsBody tr:has-text("Ahmed Hassan")')).toContainText('2023');
    await expect(page.locator('#hiItemsBody tr:has-text("Sara Ali")')).toContainText('Work From Home');
  });

  test('accepting an item records it and removes it from the waiting list', async ({ page }) => {
    await openReview(page);
    const row = page.locator('#hiItemsBody tr:has-text("Ahmed Hassan")');
    await row.locator('.btn-hi-accept').click();
    await expect(page.locator('#hiItemsBody tr:has-text("Ahmed Hassan")')).toHaveCount(0);
    await page.selectOption('#hiStatusFilter', 'all');
    await expect(page.locator('#hiItemsBody tr:has-text("Ahmed Hassan")')).toContainText('Accepted');
  });

  test('accept clear items asks first and accepts only high-confidence items without conflicts', async ({ page }) => {
    await openReview(page);
    await expect(page.locator('#hiAcceptSafeBtn')).toHaveText('Accept 2 clear items');
    await page.locator('#hiAcceptSafeBtn').click();
    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    await page.locator('#financeConfirmSubmitBtn').click();
    await expect(page.locator('#hiItemsBody')).toContainText('Nothing is waiting for review');
  });

  test('a conflicting pair and a low-confidence read are never counted as clear', async ({ page }) => {
    await openReview(page);
    await page.selectOption('#hiBatchSelect', '2');
    const sick = page.locator('#hiItemsBody tr[data-item-id="3"]');
    await expect(sick).toContainText('Conflict');
    await expect(sick).toContainText('Conflicts with staged item');
    await expect(page.locator('#hiAcceptSafeBtn')).toBeDisabled();
  });

  test('an item that overlaps existing leave is blocked and cannot be accepted', async ({ page }) => {
    await openReview(page);
    await page.selectOption('#hiBatchSelect', '3');
    const row = page.locator('#hiItemsBody tr:has-text("Nour Samir")');
    await expect(row).toContainText('Blocked');
    await expect(row.locator('.btn-hi-accept')).toBeDisabled();
  });

  test('editing the dates updates the item and clears a block', async ({ page }) => {
    await openReview(page);
    await page.selectOption('#hiBatchSelect', '3');
    const row = page.locator('#hiItemsBody tr:has-text("Nour Samir")');
    await row.locator('.btn-hi-edit').click();
    await page.fill('#hiStart', '2026-03-01');
    await page.fill('#hiEnd', '2026-03-02');
    await page.locator('#hiEditSaveBtn').click();
    await expect(page.locator('#historyItemModal')).not.toBeVisible();
    const edited = page.locator('#hiItemsBody tr:has-text("Nour Samir")');
    await expect(edited).not.toContainText('Blocked');
    await expect(edited.locator('.btn-hi-accept')).toBeEnabled();
  });

  test('rejecting needs a reason and keeps the item in the all-items view', async ({ page }) => {
    await openReview(page);
    await page.locator('#hiItemsBody tr:has-text("Sara Ali") .btn-hi-reject').click();
    await page.fill('#financeConfirmReason', 'Wrong employee');
    await page.locator('#financeConfirmSubmitBtn').click();
    await expect(page.locator('#hiItemsBody tr:has-text("Sara Ali")')).toHaveCount(0);
    await page.selectOption('#hiStatusFilter', 'all');
    await expect(page.locator('#hiItemsBody tr:has-text("Sara Ali")')).toContainText('Wrong employee');
  });

  test('hostile text in a source is shown as plain text', async ({ page }) => {
    await openReview(page);
    await page.evaluate(() => {
      window._mockHistoryImport[0].items[0].evidence_excerpt = '<img src=x onerror="window.__pwned=1">';
    });
    await page.selectOption('#hiBatchSelect', '1');
    await expect(page.locator('#hiItemsBody')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
