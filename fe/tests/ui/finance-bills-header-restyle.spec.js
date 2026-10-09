import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021): Bills header and toolbar (Slice 4)
test.describe('Bills header and toolbar, direction A', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
  });

  test('action buttons and sub-nav tabs carry no icons; search and filter keep theirs', async ({ page }) => {
    for (const id of ['financeAddVendorBtn', 'financeCaptureBillBtn', 'financeUploadDraftsBtn', 'financeRecordBillBtn']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator(`#${id} i`)).toHaveCount(0);
    }
    await expect(page.locator('#financeBillSubNav .filter-tab')).toHaveCount(4);
    await expect(page.locator('#financeBillSubNav .filter-tab i')).toHaveCount(0);
    await expect(page.locator('#financeBillSearchBox i')).toHaveCount(1);
    await expect(page.locator('#financeBillFilterToggleBtn i')).toHaveCount(1);
  });

  test('sub-nav keeps its IDs and tablist contract; active tab is underlined', async ({ page }) => {
    await expect(page.locator('#financeBillSubNav')).toHaveAttribute('role', 'tablist');
    const active = page.locator('#tabFinanceBills');
    await expect(active).toHaveAttribute('aria-selected', 'true');
    const border = await active.evaluate((el) => getComputedStyle(el).borderBottomWidth);
    expect(border).toBe('2px');
    await page.click('#tabFinanceVendors');
    await expect(page.locator('#tabFinanceVendors')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#financeAddVendorBtn')).toBeVisible();
  });

  test('toolbar wraps cleanly when narrow (no horizontal overflow)', async ({ page }) => {
    for (const width of [1100, 900]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      await expect(page.locator('#financeRecordBillBtn')).toBeVisible();
    }
  });
});
