import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// The Log Charge button and icons must stay inside the Actions column, never over the Rate amount.
for (const width of [1000, 1280, 1600, 1920]) {
  test(`subscriptions table: actions do not overlap the rate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-subscriptions');
    const row = page.locator('#financeSubscriptionsTable tbody tr').first();
    await expect(row).toBeVisible();
    const rate = await row.locator('td.cell-money').boundingBox();
    const cell = await row.locator('td').last().boundingBox();
    const btn = await row.locator('.btn-log-charge').boundingBox();
    const icons = row.locator('.fv-row-actions .fv-icon-btn, .fv-row-actions .fv-row-btn');
    const lastIcon = await icons.last().boundingBox();
    expect(btn.x).toBeGreaterThanOrEqual(rate.x + rate.width - 1);
    expect(lastIcon.x + lastIcon.width).toBeLessThanOrEqual(cell.x + cell.width + 1);
  });
}
