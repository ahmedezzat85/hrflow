import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// SI-1: effective-dated social insurance rates in Payroll settings (mock mode).
async function openSettings(page) {
  await openAdminPage(page, 'a-finance-payroll');
  await page.locator('#payrollNavSettings').click();
  await expect(page.locator('#payrollViewSettings')).toBeVisible();
}

test.describe('SI-1: dated social insurance rates', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openSettings(page);
  });

  test('shows the rate in force and the seeded history', async ({ page }) => {
    await expect(page.locator('#payrollEmployeeInsuranceRate')).toHaveValue('11.00');
    await expect(page.locator('#payrollEmployerInsuranceRate')).toHaveValue('18.00');
    await expect(page.locator('#payrollRatesEffectiveFrom')).toHaveValue(/^\d{4}-\d{2}$/);
    const rows = page.locator('#payrollRatesHistoryBody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2000-01');
    await expect(rows.first()).toContainText('11.00%');
    await expect(rows.first()).toContainText('(current)');
  });

  test('a new dated rate is added, not overwritten, and history lists newest first', async ({ page }) => {
    await page.locator('#payrollEmployerInsuranceRate').fill('18.75');
    await page.locator('#payrollRatesEffectiveFrom').fill('2099-01');
    await page.locator('#payrollViewSettings .save-bar button.btn-fill').dispatchEvent('click');
    await expect(page.locator('#payrollViewList')).toBeVisible();

    await openSettings(page);
    const rows = page.locator('#payrollRatesHistoryBody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('2099-01');
    await expect(rows.nth(0)).toContainText('18.75%');
    await expect(rows.nth(1)).toContainText('2000-01');
    await expect(rows.nth(1)).toContainText('18.00%');
    await expect(rows.nth(1)).toContainText('(current)'); // the 2099 rate is not in force yet
  });

  test('saving with nothing changed adds no row', async ({ page }) => {
    await page.locator('#payrollViewSettings .save-bar button.btn-fill').dispatchEvent('click');
    await expect(page.locator('#payrollViewList')).toBeVisible();
    await openSettings(page);
    await expect(page.locator('#payrollRatesHistoryBody tr')).toHaveCount(1);
  });
});
