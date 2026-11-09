import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Finance lists read every page the API holds and the bills pager works', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('_getAllPages follows limit/offset past the server cap and honours an explicit limit', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const rows = Array.from({ length: 230 }, (_, i) => ({ id: i + 1 }));
      const calls = [];
      const realApi = window.apiRequest;
      window.apiRequest = async (_m, url) => {
        const q = new URL(url, 'http://x').searchParams;
        calls.push(url);
        const limit = Math.min(Number(q.get('limit') || 50), 100); // the server cap
        const offset = Number(q.get('offset') || 0);
        return rows.slice(offset, offset + limit);
      };
      try {
        const all = await window._getAllPages('/api/finance/bills', { queue: 'all' }, 100);
        const n = calls.length;
        const one = await window._getAllPages('/api/finance/bills', { limit: 5 }, 100);
        return { all: all.length, last: all[all.length - 1].id, requests: n, explicit: one.length };
      } finally { window.apiRequest = realApi; }
    });
    expect(result).toEqual({ all: 230, last: 230, requests: 3, explicit: 5 });
  });

  test('Bills pager shows every bill across pages', async ({ page }) => {
    await page.evaluate(() => {
      const base = FinanceMockState.bills[0];
      for (let i = 0; i < 27; i++) FinanceMockState.bills.push({ ...base, id: 9000 + i, bill_number: `PG-${String(i).padStart(3, '0')}`, status: 'approved' });
    });
    await openAdminPage(page, 'a-finance-bills');
    const pager = page.locator('#financeBillsPagination');
    await expect(pager).toBeVisible({ timeout: 10000 });
    await expect(pager).toContainText('Page 1 of');
    const first = await page.locator('#financeBillsTableBody tr').count();
    await pager.locator('[aria-label="Next page"]').click();
    await expect(pager).toContainText('Page 2 of');
    expect(await page.locator('#financeBillsTableBody tr').count()).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(10);
  });
});
