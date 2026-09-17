import { test, expect } from '@playwright/test';

test.describe('Story 2.1 — Finance Context Bar and Trustworthy KPIs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Finance Overview
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();
    await expect(page.locator('#financeContextBar')).toBeVisible();
  });

  test('Acceptance Criteria 1: Context bar controls are visible, functional, and display correct defaults', async ({ page }) => {
    const entitySelect = page.locator('#financeContextEntity');
    const periodSelect = page.locator('#financeContextPeriod');
    const basisSelect = page.locator('#financeContextBasis');
    const currencySelect = page.locator('#financeContextCurrency');
    const resetBtn = page.locator('#btnResetFinanceContext');

    await expect(entitySelect).toBeVisible();
    await expect(periodSelect).toBeVisible();
    await expect(basisSelect).toBeVisible();
    await expect(currencySelect).toBeVisible();
    await expect(resetBtn).toBeVisible();

    // Standard defaults
    await expect(entitySelect).toHaveValue('all');
    await expect(periodSelect).toHaveValue('MTD');
    await expect(basisSelect).toHaveValue('cash');
    await expect(currencySelect).toHaveValue('USD');

    // Header context badges
    await expect(page.locator('#financeDashboardPeriodBadge')).toContainText('Period: MTD');
    await expect(page.locator('#financeDashboardBasisBadge')).toContainText('Basis: Cash');
    await expect(page.locator('#financeDashboardCurrencyBadge')).toContainText('Currency: USD');
  });

  test('Acceptance Criteria 2: Changing context persists in localStorage and reloads dashboard values', async ({ page }) => {
    // Change Period to QTD and Basis to Accrual
    await page.selectOption('#financeContextPeriod', 'QTD');
    await expect(page.locator('#financeDashboardPeriodBadge')).toContainText('Period: QTD');
    await expect(page.locator('#labelKpiRevenue')).toContainText('Revenue (QTD)');

    await page.selectOption('#financeContextBasis', 'accrual');
    await expect(page.locator('#financeDashboardBasisBadge')).toContainText('Basis: Accrual');
    await expect(page.locator('#statFinanceRevenueSubtext')).toContainText('Recognized Invoices');
    await expect(page.locator('#statFinanceCostSubtext')).toContainText('Recognized Bills');

    // Verify localStorage persistence
    const stored = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('hrflow_finance_dashboard_context') || '{}');
    });
    expect(stored.period).toBe('QTD');
    expect(stored.basis).toBe('accrual');

    // Reload page and verify context is restored
    await page.reload();
    await expect(page.locator('#adminSidebar')).toBeVisible();
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#financeContextPeriod')).toHaveValue('QTD');
    await expect(page.locator('#financeContextBasis')).toHaveValue('accrual');

    // Reset Defaults
    await page.click('#btnResetFinanceContext');
    await expect(page.locator('#financeContextPeriod')).toHaveValue('MTD');
    await expect(page.locator('#financeContextBasis')).toHaveValue('cash');
  });

  test('Acceptance Criteria 3: Multi-currency selection discloses conversion policy notice', async ({ page }) => {
    const policyNotice = page.locator('#financeContextPolicyNotice');
    await expect(policyNotice).toBeHidden();

    // Select Multi-currency
    await page.selectOption('#financeContextCurrency', 'all');
    await expect(policyNotice).toBeVisible();
    await expect(policyNotice).toContainText('without conversion');

    // Select specific USD currency
    await page.selectOption('#financeContextCurrency', 'USD');
    await expect(policyNotice).toBeHidden();
  });

  test('Acceptance Criteria 4: Trustworthy KPIs show values, definitions, and valid margin calculation', async ({ page }) => {
    const balance = page.locator('#statFinanceBalance');
    const revenue = page.locator('#statFinanceRevenue');
    const cost = page.locator('#statFinanceCost');
    const net = page.locator('#statFinanceNet');
    const marginBadge = page.locator('#statFinanceMarginBadge');

    await expect(balance).not.toHaveText('—');
    await expect(revenue).not.toHaveText('—');
    await expect(cost).not.toHaveText('—');
    await expect(net).not.toHaveText('—');

    // Margin badge should be visible with percentage
    await expect(marginBadge).toBeVisible();
    await expect(marginBadge).toContainText('Margin:');

    // Click KPI definition button
    await page.click('#cardKpiRevenue button[title*="Actual cash inflows"]');
    const toast = page.locator('#toastWrap .toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Revenue');
  });

  test('Acceptance Criteria 5: KPI drill-down links navigate to corresponding records', async ({ page }) => {
    // Click View Accounts drilldown link on Cash Balance card
    await page.click('#drilldownKpiCash');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Navigate back to Dashboard
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Click View Reports drilldown link on Net Result card
    await page.click('#drilldownKpiNet');
    await expect(page.locator('#a-finance-reports')).toBeVisible();
  });
});
