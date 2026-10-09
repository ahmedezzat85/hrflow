import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021): Record bill dialog (Slice 5). Visual only; behaviour is covered by the bill specs.
test.describe('Record bill dialog, direction A', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();
  });

  test('keeps the dialog contract, sectioned fields and footer actions', async ({ page }) => {
    const dialog = page.locator('#billModal .modal').first();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#billModalSaveBtn')).toBeVisible();
    await expect(page.locator('#billModal .modal-foot').first()).toBeVisible();
    expect(await page.locator('#billModal .form-section').count()).toBeGreaterThan(2);
    expect(await page.locator('#billModal .modal-head').first().evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('1px');
    expect(await page.locator('#billModal .modal-foot').first().evaluate((el) => getComputedStyle(el).justifyContent)).toBe('flex-end');
  });

  test('closes with the close button', async ({ page }) => {
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });
});
