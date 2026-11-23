import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// The statutory obligations table shows the date paid, not the due date. The real value (latest payment in force) is
// covered by be/tests/test_finance_statutory_obligations.py; mock mode reproduces what the screen shows.
test.describe('Statutory obligations: Paid column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-statutory');
    await expect(page.locator('#financeStatutoryTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('The column is called Paid, not Due', async ({ page }) => {
    const heads = await page.locator('#financeStatutoryTable thead th').allTextContents();
    expect(heads.map((h) => h.trim())).toContain('Paid');
    expect(heads.map((h) => h.trim())).not.toContain('Due');
  });

  test('A remitted obligation shows its paid date and an unpaid one shows a dash', async ({ page }) => {
    const paid = await page.evaluate(() => window.FinanceUI.formatDate('2026-09-08'));
    const remitted = page.locator('#financeStatutoryTableBody tr:has-text("Remitted")').first();
    await expect(remitted.locator('td').nth(1)).toHaveText(paid);
    const unpaid = page.locator('#financeStatutoryTableBody tr:has-text("Estimated")').first();
    await expect(unpaid.locator('td').nth(1)).toHaveText('–');
  });
});
