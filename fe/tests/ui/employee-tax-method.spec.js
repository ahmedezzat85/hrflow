import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// FT-1: employee-level tax method card (progressive | flat), mock mode.
async function openFirstEmployee(page) {
  await openAdminPage(page, 'a-employees');
  const firstRow = page.locator('#employeesTableBody tr').first();
  await expect(firstRow).toBeVisible();
  await firstRow.locator('td.tname a').click();
  await expect(page.locator('#a-employee-detail')).toBeVisible();
  await expect(page.locator('#taxMethodPill')).not.toContainText('Loading');
}

test.describe('FT-1: Employee tax method', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('card defaults to Normal (progressive) next to Social insurance', async ({ page }) => {
    await openFirstEmployee(page);
    const card = page.locator('#taxMethodCard');
    await expect(card).toBeVisible();
    await expect(card.locator('h3')).toContainText('Tax method');
    await expect(card.locator('#taxMethodPill')).toContainText('Normal');
    await expect(card.locator('#taxMethodName')).toContainText('Normal (progressive)');
    await expect(page.locator('#socialInsuranceCard')).toBeVisible();
    await expect(page.locator('#taxMethodHistory')).toBeHidden();
  });

  test('sets a flat rate, then switches back to normal, with history oldest to newest', async ({ page }) => {
    await openFirstEmployee(page);
    await page.locator('#taxMethodActionBtn').click();
    const modal = page.locator('#taxMethodModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fTaxRateContainer')).toBeHidden();
    await expect(modal.locator('#taxMethodDateHint')).toContainText('whole month');

    await modal.locator('#fTaxMethodFlat').check();
    await expect(modal.locator('#fTaxRateContainer')).toBeVisible();

    // rate is required, and must be a percent in (0, 100]
    await modal.locator('#fTaxMethodEffectiveDate').fill('2025-01-01');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).toBeVisible();
    await modal.locator('#fTaxMethodRate').fill('150');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).toBeVisible();

    // future dates are refused
    await modal.locator('#fTaxMethodRate').fill('10');
    await modal.locator('#fTaxMethodEffectiveDate').fill('2099-01-01');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).toBeVisible();

    await modal.locator('#fTaxMethodEffectiveDate').fill('2025-01-01');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).not.toBeVisible();

    const card = page.locator('#taxMethodCard');
    await expect(card.locator('#taxMethodPill')).toContainText('Flat 10%');
    await expect(card.locator('#taxMethodName')).toContainText('Flat rate');
    await expect(card.locator('#taxMethodRate')).toContainText('10%');
    await expect(card.locator('#taxMethodEffectiveDate')).toContainText('2025-01-01');

    // an earlier date than the active row is rejected by the (mock) backend rules
    await page.locator('#taxMethodActionBtn').click();
    await modal.locator('#fTaxMethodEffectiveDate').fill('2024-01-01');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).toBeVisible();

    // switch to normal from a later date
    await modal.locator('#fTaxMethodProgressive').check();
    await modal.locator('#fTaxMethodEffectiveDate').fill('2025-07-01');
    await modal.locator('#taxMethodSaveBtn').dispatchEvent('click');
    await expect(modal).not.toBeVisible();
    await expect(card.locator('#taxMethodPill')).toContainText('Normal');

    const rows = card.locator('#taxMethodHistoryBody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('2025-01-01');
    await expect(rows.nth(0)).toContainText('2025-06-30');
    await expect(rows.nth(0)).toContainText('Flat 10%');
    await expect(rows.nth(1)).toContainText('2025-07-01');
    await expect(rows.nth(1)).toContainText('Present');
    await expect(rows.nth(1)).toContainText('Normal (progressive)');
  });

  test('editing needs hr.salary.write; viewing does not', async ({ page }) => {
    await page.evaluate(() => {
      const original = SessionInfo.hasPermission;
      SessionInfo.hasPermission = (k) => k !== 'hr.salary.write' && original.call(SessionInfo, k);
    });
    await openFirstEmployee(page);
    await expect(page.locator('#taxMethodCard')).toBeVisible();
    await expect(page.locator('#taxMethodPill')).toContainText('Normal');
    await expect(page.locator('#taxMethodActionBtn')).toBeHidden();
    await expect(page.locator('#taxMethodStatusActionBtn')).toBeHidden();
  });

  test('payroll statutory table labels flat-tax lines', async ({ page }) => {
    await openAdminPage(page, 'a-finance-payroll');
    await page.evaluate(() => {
      const mk = (id, name, method, rate, tax) => ({
        employee_id: id, employee_name: name, compensation_type: 'internal_usd_cash', net_pay: 2000,
        final_internal_net_egp: 100000, employee_tax_egp: tax, tax_method_snapshot: method, tax_rate_snapshot: rate,
      });
      window.PayrollApp.currentRun = { lines: [mk(901, 'Flat Fiona', 'flat', 0.1, 11111.11), mk(902, 'Normal Nora', 'progressive', null, 500)] };
      window.PayrollApp.drawScreen3();
    });
    const body = page.locator('#payrollProcessingTableBody');
    const flat = body.locator('tr:has-text("Flat Fiona")');
    await expect(flat).toContainText('11,111.11');
    await expect(flat.locator('.payroll-flat-tax-label')).toHaveText('Flat 10%');
    await expect(body.locator('tr:has-text("Normal Nora") .payroll-flat-tax-label')).toHaveCount(0);
  });
});
