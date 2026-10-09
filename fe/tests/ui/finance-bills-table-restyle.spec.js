import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021): Bills table (Slice 2)
test.describe('Bills table, direction A', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.removeItem('hrflow_finance_table_density'));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
  });

  test('dates keep the year, vendor cell stacks bill number, overdue note sits under the due date', async ({ page }) => {
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(row.first()).toContainText('Amazon Web Services');
    await expect(row.first()).toContainText('BILL-2026-001 · 1 Sep 2026');
    await expect(row.first()).toContainText('30 Sep 2026');
    await expect(row.first().locator('.bill-cell-sub--late')).toContainText(/\d+ days? late/);
    await expect(row.first().locator('td.cell-money')).toContainText('$4,200.00');
  });

  test('no horizontal scroll at 1440 px and rows follow the density setting', async ({ page }) => {
    const scrolls = await page.evaluate(() => {
      const c = document.getElementById('financeBillsContainer');
      return c.scrollWidth > c.clientWidth + 1;
    });
    expect(scrolls).toBe(false);

    const heights = {};
    for (const d of ['compact', 'regular', 'spacious']) {
      await page.evaluate((v) => {
        localStorage.setItem('hrflow_finance_table_density', v);
        const t = document.getElementById('financeBillsTable');
        t.classList.remove('density-compact', 'density-regular', 'density-spacious');
        t.classList.add('density-' + v);
      }, d);
      heights[d] = await page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")').first().evaluate((r) => r.getBoundingClientRect().height);
    }
    expect(heights.compact).toBeLessThan(heights.regular);
    expect(heights.regular).toBeLessThan(heights.spacious);
    expect(heights.regular).toBeGreaterThan(48);
    expect(heights.regular).toBeLessThan(60);
  });

  test('More menu: opens, is keyboard operable, closes on Escape, hosts view/edit/attachment', async ({ page }) => {
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    const more = row.locator('.btn-bill-more');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = row.locator('.bill-row-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role=menuitem]')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
  });
});
