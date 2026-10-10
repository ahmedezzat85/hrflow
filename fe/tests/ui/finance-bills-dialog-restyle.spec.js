import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021): New bill dialog, the C modal from
// docs/finance-module/mocks/bills-restyle-final.html. Behaviour is covered by the bill specs.
test.describe('New bill dialog, C modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();
  });

  test('keeps the dialog contract and shows the status chip in the header', async ({ page }) => {
    const dialog = page.locator('#billModal .modal').first();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#billModal .modal-head #billStatusReadOnlyBadge')).toBeVisible();
    await expect(page.locator('#billModalTitleText')).toBeVisible();
  });

  test('fields follow the agreed order and there is no review checkbox', async ({ page }) => {
    const order = await page.evaluate(() => {
      const ids = ['billVendorId', 'billNumber', 'billCategoryId', 'billIssueDate', 'billAmount', 'billDueDate'];
      const els = ids.map((id) => document.getElementById(id));
      return els.every(Boolean) && els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    });
    expect(order).toBe(true);
    await expect(page.locator('#billCurrency')).toBeVisible();
    await expect(page.locator('label[for="billIssueDate"]')).toContainText('Bill date');
    await expect(page.locator('#billIsReviewed')).toHaveCount(0);
    await expect(page.locator('#billModal')).not.toContainText('Mark verified and reviewed');
  });

  test('payment choice is a two-option bar over radios; Already paid reveals the payment fields', async ({ page }) => {
    const bar = page.locator('#billPaidChoiceRow');
    await expect(bar).toHaveAttribute('role', 'radiogroup');
    await expect(bar.locator('input[type=radio]')).toHaveCount(2);
    await expect(page.locator('#billPaidChoiceNo')).toBeChecked();
    await expect(page.locator('#billPaidNowSection')).toBeHidden();

    await bar.locator('label', { hasText: 'Already paid' }).click();
    await expect(page.locator('#billPaidChoiceYes')).toBeChecked();
    await expect(page.locator('#billPaidNowSection')).toBeVisible();
    await expect(page.locator('#billSavesAsLine')).toContainText('Saves as');

    await bar.locator('label', { hasText: 'Not paid yet' }).click();
    await expect(page.locator('#billPaidChoiceNo')).toBeChecked();
    await expect(page.locator('#billPaidNowSection')).toBeHidden();
  });

  test('More details is collapsed by default, toggles, and opens by itself when line items exist', async ({ page }) => {
    const toggle = page.locator('#billMoreToggle');
    const section = page.locator('#billMoreSection');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(section).toBeHidden();
    await expect(page.locator('#billDepartment')).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(section).toBeVisible();
    for (const id of ['#billLegalEntity', '#billDepartment', '#billNotes', '#billLinesBody']) {
      await expect(page.locator(id)).toHaveCount(1);
    }
    await toggle.click();
    await expect(section).toBeHidden();

    // A line item with a value reveals the section
    await page.evaluate(() => { setBillMoreExpanded(true); addBillLine(); });
    await page.locator('#billLinesBody tr input.bill-price').first().fill('250');
    await page.locator('#billLinesBody tr input.bill-price').first().dispatchEvent('input');
    await page.evaluate(() => setBillMoreExpanded(false));
    await page.locator('#billLinesBody tr input.bill-price').first().dispatchEvent('input');
    await expect(section).toBeVisible();
  });

  test('footer: draft and add-another on the left, cancel and the primary action on the right', async ({ page }) => {
    const left = page.locator('#billModal .bill-foot-left');
    const right = page.locator('#billModal .bill-foot-right');
    await expect(left.locator('#billSaveDraftBtn')).toBeVisible();
    await expect(left.locator('#billAddAnother')).toBeVisible();
    await expect(right.locator('#billModalSaveBtn')).toBeVisible();
    await expect(right.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('closes with the close button', async ({ page }) => {
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });
});
