import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Sales commissions. Accrual on a fully paid invoice, voiding on a receipt reversal, permissions and the
// real report query are covered by be/tests/test_finance_sales_commissions.py (mock mode cannot prove them).
test.describe('Sales commissions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Settings > Salespeople: list, add, duplicate refused, deactivate', async ({ page }) => {
    await openAdminPage(page, 'a-finance-settings');
    await page.click('#subtabSettingsSalespeople');
    await expect(page.locator('#financeSettingsPaneSalespeople')).toBeVisible();
    const body = page.locator('#financeSalespeopleTableBody');
    await expect(body.locator('tr')).toHaveCount(3);
    await expect(body).toContainText('Sarah Connor');

    await page.click('#financeAddSalespersonBtn');
    await expect(page.locator('#financeSalespersonModal')).toBeVisible();
    await page.fill('#fSalespersonName', 'Mona Adel');
    await page.click('#financeSalespersonSaveBtn');
    await expect(page.locator('#financeSalespersonModal')).not.toBeVisible();
    await expect(body.locator('tr:has-text("Mona Adel")')).toBeVisible();

    // A duplicate name is refused and the dialog stays open
    await page.click('#financeAddSalespersonBtn');
    await page.fill('#fSalespersonName', 'sarah connor');
    await page.click('#financeSalespersonSaveBtn');
    await expect(page.locator('#financeSalespersonModal')).toBeVisible();
    await page.click('#financeSalespersonModal button:has-text("Cancel")');
    await expect(page.locator('#financeSalespersonModal')).not.toBeVisible();

    // Deactivate
    await body.locator('tr:has-text("Mona Adel") .btn-salesperson-toggle').click();
    await page.click('button:has-text("Deactivate Salesperson")');
    await expect(body.locator('tr:has-text("Mona Adel")')).toContainText('Inactive');
  });

  test('Customer form: pick a salesperson and a commission rate, saved on the customer', async ({ page }) => {
    await page.evaluate(() => window.openAddCustomerModal());
    await expect(page.locator('#customerModal')).toBeVisible();
    const options = await page.locator('#fCustomerSalesperson option').allTextContents();
    expect(options).toContain('Sarah Connor');
    expect(options.join('|')).not.toContain('Retired Rep'); // inactive ones are not offered for a new link

    await page.fill('#fCustomerName', 'Commissioned Customer');
    await page.selectOption('#fCustomerSalesperson', { label: 'Sarah Connor' });
    await page.fill('#fCustomerCommission', '4.5');
    await page.click('#customerSaveBtn');
    await expect(page.locator('#customerModal')).not.toBeVisible();

    const saved = await page.evaluate(() => window.FinanceMockState.customers.find((c) => c.name === 'Commissioned Customer'));
    expect(saved.salesperson_id).toBe(1);
    expect(saved.salesperson_name).toBe('Sarah Connor');
    expect(saved.commission_rate).toBe(4.5);
  });

  test('Reports > Sales Commissions: per salesperson totals for the chosen quarter', async ({ page }) => {
    await openAdminPage(page, 'a-finance-reports');
    await page.evaluate(() => window.openReportFromLibrary('sales-commissions'));
    await expect(page.locator('#reportPaneSalesCommissions')).toBeVisible();

    await page.selectOption('#reportCommYear', '2026');
    await page.selectOption('#reportCommQuarter', '3');
    const sarah = page.locator('#reportCommSalespeople [data-salesperson-id="1"]');
    await expect(sarah).toContainText('Sarah Connor');
    await expect(sarah).toContainText('INV-2026-101');
    await expect(sarah).toContainText('INV-2026-102');
    await expect(page.locator('#reportCommSalespeople [data-salesperson-id="2"]')).toContainText('Omar Khaled');
    // totals are kept per currency
    await expect(page.locator('#reportCommGrandTotals')).toContainText('USD');
    await expect(page.locator('#reportCommGrandTotals')).toContainText('EGP');
    await expect(page.locator('#reportCommEmpty')).toBeHidden();

    // filter to one salesperson
    await page.selectOption('#reportCommSalesperson', '2');
    await expect(page.locator('#reportCommSalespeople [data-salesperson-id]')).toHaveCount(1);

    // a quarter with nothing shows the empty state
    await page.selectOption('#reportCommQuarter', '1');
    await expect(page.locator('#reportCommEmpty')).toBeVisible();
  });

  test('Settlement: quarterly salesperson per quarter, monthly employee per month, undo', async ({ page }) => {
    await openAdminPage(page, 'a-finance-reports');
    await page.evaluate(() => window.openReportFromLibrary('sales-commissions'));
    await page.selectOption('#reportCommYear', '2026');
    await page.selectOption('#reportCommQuarter', '3');

    // Sarah is settled quarterly: one period for the whole quarter
    const sarah = page.locator('#reportCommSalespeople [data-salesperson-id="1"]');
    await expect(sarah).toContainText('settled quarterly');
    await expect(sarah.locator('[data-period-start]')).toHaveCount(1);
    await sarah.locator('.btn-commission-settle').click();
    await expect(page.locator('#commissionSettleModal')).toBeVisible();
    await page.fill('#fSettleDate', '2026-10-05');
    await page.fill('#fSettleReference', 'Wire 77');
    await page.click('#commissionSettleSaveBtn');
    await expect(page.locator('#commissionSettleModal')).not.toBeVisible();
    await expect(sarah).toContainText('Wire 77');
    await expect(sarah.locator('.btn-commission-settle')).toHaveCount(0);

    // Undo puts it back to open
    await sarah.locator('.btn-commission-undo').click();
    await page.click('button:has-text("Undo settlement")');
    await expect(sarah.locator('.btn-commission-settle')).toHaveCount(1);

    // Omar is an employee settled monthly: his July commission is its own period
    const omar = page.locator('#reportCommSalespeople [data-salesperson-id="2"]');
    await expect(omar).toContainText('settled monthly');
    await expect(omar.locator('[data-period-start="2026-07-01"]')).toContainText('Jul 2026');
  });
});
