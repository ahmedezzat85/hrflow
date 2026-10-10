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

  test('action buttons and sub-nav tabs carry no icons; search keeps its icon; no Filters or Upload / Capture button', async ({ page }) => {
    for (const id of ['financeAddVendorBtn', 'financeUploadDraftsBtn', 'financeRecordBillBtn']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator(`#${id} i`)).toHaveCount(0);
    }
    await expect(page.locator('#financeBillSubNav .filter-tab')).toHaveCount(4);
    await expect(page.locator('#financeBillSubNav .filter-tab i')).toHaveCount(0);
    await expect(page.locator('#financeBillSearchBox i')).toHaveCount(1);
    await expect(page.locator('#financeCaptureBillBtn')).toHaveCount(0);
    await expect(page.locator('#financeBillFilterToggleBtn')).toHaveCount(0);
    await expect(page.locator('#financeUploadDraftsBtn')).toHaveText('Upload bills');
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

  test('the same underline tab bar is used on Subscriptions and Statutory (no icons, no style switch)', async ({ page }) => {
    await page.click('#tabFinanceSubscriptions');
    const subs = page.locator('#financeSpendSubNavSubscriptions');
    await expect(subs).toBeVisible();
    await expect(subs.locator('.filter-tab')).toHaveCount(4);
    await expect(subs.locator('.filter-tab i')).toHaveCount(0);
    expect(await subs.locator('.filter-tab.active').evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('2px');
    await page.click('#subtabSpendSubStatutory');
    const stat = page.locator('#financeSpendSubNavStatutory');
    await expect(stat.locator('.filter-tab i')).toHaveCount(0);
    expect(await stat.locator('.filter-tab.active').evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('2px');
  });

  test('search sits in the right-hand group next to the buttons, not beside the tabs', async ({ page }) => {
    const m = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      return { tabsRight: r('financeBillSubNav').right, searchLeft: r('financeBillSearchBox').left, searchRight: r('financeBillSearchBox').right, addLeft: r('financeAddVendorBtn').left };
    });
    expect(m.searchLeft).toBeGreaterThan(m.tabsRight + 100);
    expect(m.searchRight).toBeLessThanOrEqual(m.addLeft);
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
