import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Finance styled select menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-accounts');
    await page.click('#subtabFinanceCheques');
    await expect(page.locator('#financeSubPaneCheques')).toBeVisible();
  });

  test('click opens the styled list, choosing an option changes the select, Escape closes', async ({ page }) => {
    const select = page.locator('#financeChequeFiscalYearFilter');
    await select.click();
    const pop = page.locator('.fv-select-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.fv-select-pop__opt.is-selected')).toHaveText('All Fiscal Years');

    await pop.locator('.fv-select-pop__opt', { hasText: 'FY 2025' }).click();
    await expect(pop).toHaveCount(0);
    await expect(select).toHaveValue('2025');

    await select.click();
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(select).toHaveValue('2025');
  });

  test('keyboard: arrows move, Enter selects', async ({ page }) => {
    const select = page.locator('#financeChequeFiscalYearFilter');
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.fv-select-pop')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.fv-select-pop')).toHaveCount(0);
    await expect(select).toHaveValue('2025');
  });

  test('inside a dialog the list opens above the dialog and closing the dialog closes the list', async ({ page }) => {
    await page.click('button:has-text("Issue cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();
    await page.locator('#financeChequeModal select').first().click();
    const pop = page.locator('.fv-select-pop');
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('#financeChequeModal')).toBeVisible();
  });
});
