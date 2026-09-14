import { test, expect } from '@playwright/test';

test.describe('Story 7.2: Core Accounting and Aging Reports', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Reports
    await page.click('#adminSidebar a[data-page="a-finance-reports"]');
    await expect(page.locator('#a-finance-reports')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1: Profit & Loss Statement displays revenue, expenses, net income, margin %, and drilldown', async ({ page }) => {
    // Open Profit & Loss Statement from library catalog
    const pnlCard = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Profit & Loss")');
    await expect(pnlCard).toBeVisible();
    await pnlCard.locator('button').click();

    // Verify shell and P&L pane are visible
    await expect(page.locator('#reportShellContainer')).toBeVisible();
    const pnlPane = page.locator('#reportPaneProfitAndLoss');
    await expect(pnlPane).toBeVisible();

    // Verify KPI banner
    await expect(page.locator('#reportPnlTotalRevenue')).toContainText('$');
    await expect(page.locator('#reportPnlTotalExpenses')).toContainText('$');
    await expect(page.locator('#reportPnlNetIncome')).toContainText('$');
    await expect(page.locator('#reportPnlNetMargin')).toContainText('%');

    // Verify Revenue & Expense tables
    const revRows = page.locator('#reportPnlRevenueTableBody tr');
    await expect(revRows.first()).toBeVisible();

    const expRows = page.locator('#reportPnlExpenseTableBody tr');
    await expect(expRows.first()).toBeVisible();

    // Click drill-down on first revenue item
    await revRows.first().locator('button').click();
    const drillModal = page.locator('#reportDrilldownModal');
    await expect(drillModal).toBeVisible();
    await expect(drillModal.locator('#reportDrilldownTitle')).toBeVisible();
    await drillModal.locator('.modal-close').click();
    await expect(drillModal).not.toBeVisible();
  });

  test('AC 2: Balance Sheet displays assets, liabilities, equity, and verifies balanced equation', async ({ page }) => {
    // Open Category Spend Rollup first then switch via subnav
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Switch to Balance Sheet tab
    await page.click('#financeReportsSubNav button[data-report-tab="balance-sheet"]');
    const bsPane = page.locator('#reportPaneBalanceSheet');
    await expect(bsPane).toBeVisible();

    // Verify KPI banner
    await expect(page.locator('#reportBsTotalAssets')).toContainText('$');
    await expect(page.locator('#reportBsTotalLiabilities')).toContainText('$');
    await expect(page.locator('#reportBsTotalEquity')).toContainText('$');
    await expect(page.locator('#reportBsBalancedBadge')).toContainText('BALANCED');

    // Verify table items
    await expect(page.locator('#reportBsAssetsTableBody tr').first()).toBeVisible();
    await expect(page.locator('#reportBsLiabilitiesTableBody tr').first()).toBeVisible();
    await expect(page.locator('#reportBsEquityTableBody tr').first()).toBeVisible();
  });

  test('AC 3: Trial Balance validates debits equal credits with zero variance', async ({ page }) => {
    // Open through subnav
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Switch to Trial Balance tab
    await page.click('#financeReportsSubNav button[data-report-tab="trial-balance"]');
    const tbPane = page.locator('#reportPaneTrialBalance');
    await expect(tbPane).toBeVisible();

    // Verify KPI banner debits equal credits
    await expect(page.locator('#reportTbTotalDebits')).toContainText('$');
    await expect(page.locator('#reportTbTotalCredits')).toContainText('$');
    await expect(page.locator('#reportTbBalancedBadge')).toContainText('DEBITS = CREDITS');
    await expect(page.locator('#reportTbVariance')).toContainText('$0.00');

    // Verify ledger accounts and total footer
    const rows = page.locator('#reportTbTableBody tr');
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('#reportTbTableFoot')).toContainText('TOTALS:');
  });

  test('AC 4: Statement of Cash Flows displays operating flows and beginning/ending cash reconciliation', async ({ page }) => {
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Switch to Cash Flow tab
    await page.click('#financeReportsSubNav button[data-report-tab="cash-flow"]');
    const cfPane = page.locator('#reportPaneCashFlow');
    await expect(cfPane).toBeVisible();

    // Verify KPI banner
    await expect(page.locator('#reportCfBeginningCash')).toContainText('$');
    await expect(page.locator('#reportCfOperatingCash')).toContainText('$');
    await expect(page.locator('#reportCfNetChange')).toContainText('$');
    await expect(page.locator('#reportCfEndingCash')).toContainText('$');

    // Verify statement rows in table
    const cfTable = page.locator('#reportCfTable');
    await expect(cfTable).toContainText('Operating Activities');
    await expect(cfTable).toContainText('Beginning of Period');
    await expect(cfTable).toContainText('End of Period');
  });

  test('AC 5: AR Aging and AP Aging reports partition by 30-day buckets with drilldown', async ({ page }) => {
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // 1. AR Aging Tab
    await page.click('#financeReportsSubNav button[data-report-tab="ar-aging"]');
    const arPane = page.locator('#reportPaneArAging');
    await expect(arPane).toBeVisible();

    // Verify AR KPI buckets
    await expect(page.locator('#reportArTotalOutstanding')).toContainText('$');
    await expect(page.locator('#reportArCurrent')).toContainText('$');
    await expect(page.locator('#reportArDays130')).toContainText('$');
    await expect(page.locator('#reportArDays3160')).toContainText('$');

    // Verify customer rows
    const arRows = page.locator('#reportArAgingTableBody tr');
    await expect(arRows.first()).toBeVisible();
    await expect(page.locator('#reportArAgingTableFoot')).toContainText('TOTAL RECEIVABLES:');

    // Drill down on first customer
    await arRows.first().locator('button').click();
    const drillModal = page.locator('#reportDrilldownModal');
    await expect(drillModal).toBeVisible();
    await drillModal.locator('.modal-close').click();
    await expect(drillModal).not.toBeVisible();

    // 2. AP Aging Tab
    await page.click('#financeReportsSubNav button[data-report-tab="ap-aging"]');
    const apPane = page.locator('#reportPaneApAging');
    await expect(apPane).toBeVisible();

    // Verify AP KPI buckets
    await expect(page.locator('#reportApTotalOutstanding')).toContainText('$');
    await expect(page.locator('#reportApCurrent')).toContainText('$');
    await expect(page.locator('#reportApDays130')).toContainText('$');
    await expect(page.locator('#reportApDays3160')).toContainText('$');

    // Verify vendor rows
    const apRows = page.locator('#reportApAgingTableBody tr');
    await expect(apRows.first()).toBeVisible();
    await expect(page.locator('#reportApAgingTableFoot')).toContainText('TOTAL PAYABLES:');

    // Drill down on first vendor
    await apRows.first().locator('button').click();
    await expect(drillModal).toBeVisible();
    await drillModal.locator('.modal-close').click();
    await expect(drillModal).not.toBeVisible();
  });
});
