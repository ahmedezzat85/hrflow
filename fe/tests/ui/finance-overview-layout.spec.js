import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// R5 Finance Overview: the cash card names its scope, KPI labels are sentence case,
// and no KPI icon tile overlaps its label or info icon.

async function openOverview(page, size, theme = 'light') {
  await page.setViewportSize(size);
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await openAdminPage(page, 'a-finance-dashboard');
  await expect(page.locator('#statFinanceBalance')).not.toContainText('—', { timeout: 15000 });
}

test.describe('R5 Finance Overview', () => {
  test('cash card names the currency it covers; no "All Accounts" over a single-currency figure', async ({ page }) => {
    await openOverview(page, { width: 1440, height: 900 });
    await expect(page.locator('#labelKpiBalance')).toContainText('USD accounts');
    await page.selectOption('#financeContextCurrency', 'EGP');
    await expect(page.locator('#labelKpiBalance')).toContainText('EGP accounts', { timeout: 10000 });
    const texts = await page.locator('#cardKpiCashBalance .stat-label, #cardKpiRevenue .stat-label, #cardKpiCost .stat-label, #cardKpiNet .stat-label, #financeDashboardScopeBadge').allInnerTexts();
    for (const t of texts) expect(t).not.toMatch(/all accounts/i);
  });

  test('KPI labels are sentence case, not all capitals', async ({ page }) => {
    await openOverview(page, { width: 1440, height: 900 });
    const labels = await page.locator('#cardKpiCashBalance .stat-label, #cardKpiRevenue .stat-label, #cardKpiCost .stat-label, #cardKpiNet .stat-label').evaluateAll((els) => els.map((e) => ({
      text: e.textContent.trim(), transform: getComputedStyle(e).textTransform,
    })));
    expect(labels).toHaveLength(4);
    for (const l of labels) {
      expect(l.transform, l.text).toBe('none');
      expect(l.text, l.text).not.toBe(l.text.toUpperCase());
    }
    await expect(page.locator('#labelKpiCost')).toHaveText('Operating expenses, month to date');
  });

  for (const width of [1280, 1440, 1646]) {
    for (const theme of ['light', 'dark']) {
      test(`no KPI icon tile overlaps its label or info icon at ${width}px (${theme})`, async ({ page }) => {
        await openOverview(page, { width, height: 900 }, theme);
        const overlaps = await page.evaluate(() => {
          const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const bad = [];
          document.querySelectorAll('#cardKpiCashBalance, #cardKpiRevenue, #cardKpiCost, #cardKpiNet').forEach((card) => {
            const tile = card.querySelector('.stat-icon').getBoundingClientRect();
            const label = card.querySelector('.stat-label span').getBoundingClientRect();
            const info = card.querySelector('.stat-label button').getBoundingClientRect();
            if (hit(tile, label)) bad.push(`${card.id}: label`);
            if (hit(tile, info)) bad.push(`${card.id}: info`);
          });
          return bad;
        });
        expect(overlaps).toEqual([]);
      });
    }
  }
});
