import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// F6 (D-026). The real classification of reversals, withdrawals, payroll and statutory rows is covered by
// be/tests/test_finance_cash_basis.py; mock mode reproduces the visible states.
test.describe('Cash basis P&L and per-currency columns (F6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  const openDashboard = async (page) => {
    await openAdminPage(page, 'a-finance-dashboard');
    await expect(page.locator('#financeContextBar')).toBeVisible();
  };

  test('Dashboard defaults to cash basis; "All currencies" shows one figure per currency and no converted total', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('#financeContextBasis')).toHaveValue('cash');
    await page.selectOption('#financeContextCurrency', 'all');
    await expect(page.locator('#statFinanceRevenue')).toContainText('EGP');
    await expect(page.locator('#statFinanceRevenue')).toContainText('$');
    await expect(page.locator('#statFinanceBalance')).toContainText('EGP');
    await expect(page.locator('#statFinanceBalance')).toContainText('$245,000');
    const balance = await page.locator('#statFinanceBalance').innerText();
    expect(balance).not.toContain('715,000');
  });

  test('Accrual view is labelled partial', async ({ page }) => {
    await openDashboard(page);
    await page.selectOption('#financeContextBasis', 'accrual');
    await expect(page.locator('#financeDashboardBasisBadge')).toContainText('Partial: excludes payroll, statutory and bank fees');
    await page.selectOption('#financeContextBasis', 'cash');
    await expect(page.locator('#financeDashboardBasisBadge')).not.toContainText('Partial');
  });

  test('P&L report with All Currencies lists each currency separately and the accrual P&L is labelled partial', async ({ page }) => {
    await openAdminPage(page, 'a-finance-reports');
    await page.evaluate(() => window.openReportFromLibrary('profit-and-loss'));
    await expect(page.locator('#reportPaneProfitAndLoss')).toBeVisible();
    await page.selectOption('#reportShellCurrency', '');
    await expect(page.locator('#reportPnlTotalRevenue')).toContainText('EGP');
    await expect(page.locator('#reportPnlTotalRevenue')).toContainText('$');
    await expect(page.locator('#reportPnlRevenueTableBody')).toContainText('(EGP)');
    await expect(page.locator('#reportPnlRevenueTableBody')).toContainText('(USD)');
    await expect(page.locator('#reportPnlBasisNote')).toBeHidden();

    await page.selectOption('#reportShellBasis', 'accrual');
    await expect(page.locator('#reportPnlBasisNote')).toContainText('Partial: excludes payroll, statutory and bank fees');
  });
});
