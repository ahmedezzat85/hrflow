import { test, expect } from '@playwright/test';

test.describe('FUX-419: Compensation Spend & Variance Reporting UI Suite', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Financial Reports
    await page.click('#adminSidebar a[data-page="a-finance-reports"]');
    await expect(page.locator('#a-finance-reports')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1 & AC 2: Compensation Spend Report renders KPIs, company table, and employee drilldown', async ({ page }) => {
    // 1. Filter by Payroll domain
    await page.click('#reportLibraryCategoryPills button[data-domain="Payroll"]');
    const cards = page.locator('#reportLibraryGrid .report-catalog-card');
    await expect(cards).toHaveCount(4); // payroll-summary, compensation-summary, statutory-remitted, payable-status

    // 2. Open Compensation Spend Report
    const compCard = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Compensation Spend & Variance Report")');
    await compCard.locator('button:has-text("Open Report")').click();

    const pane = page.locator('#reportPaneCompensationSummary');
    await expect(pane).toBeVisible({ timeout: 5000 });

    // Verify KPI Summary Cards
    await expect(pane.locator('#reportCompTotalSpend')).toContainText('$');
    await expect(pane.locator('#reportCompExternal')).toContainText('$');
    await expect(pane.locator('#reportCompInternal')).toContainText('$');
    await expect(pane.locator('#reportCompCommBonus')).toContainText('$');
    await expect(pane.locator('#reportCompHeadcount')).not.toHaveText('0');

    // Verify Company Spend Table
    const companyTable = pane.locator('#reportCompanySpendTable');
    await expect(companyTable).toBeVisible();
    await expect(companyTable.locator('tbody tr')).toHaveCount(3); // Sarah, Marcus, Elena
    await expect(companyTable.locator('tbody')).toContainText('Sarah Jenkins');
    await expect(companyTable.locator('tbody')).toContainText('Marcus Vance');

    // 3. Drill down into Sarah Jenkins
    const drillBtn = companyTable.locator('tr:has-text("Sarah Jenkins") button:has-text("Drilldown")');
    await drillBtn.click();

    // Verify view mode toggles to Employee card
    const empCard = pane.locator('#reportEmployeeSpendCard');
    await expect(empCard).toBeVisible();
    await expect(empCard.locator('#reportEmployeeSpendTitle')).toContainText('Sarah Jenkins');
    await expect(empCard.locator('#reportEmployeeSpendTable tbody tr')).toHaveCount(6);

    // Switch back to Company Summary
    await empCard.locator('button:has-text("Back to Company Summary")').click();
    await expect(pane.locator('#reportCompanySpendCard')).toBeVisible();
  });

  test('AC 3: Statutory Obligations Remitted Report shows only actual remitted figures', async ({ page }) => {
    // Open via subnav fast switching
    const openBtn = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Statutory Obligations Remitted Report") button');
    await openBtn.click();

    const pane = page.locator('#reportPaneStatutoryRemitted');
    await expect(pane).toBeVisible({ timeout: 5000 });

    // Verify KPIs
    await expect(pane.locator('#reportStatTotalRemitted')).toContainText('$3,450.00');
    await expect(pane.locator('#reportStatTaxRemitted')).toContainText('$1,500.00');
    await expect(pane.locator('#reportStatInsRemitted')).toContainText('$1,950.00'); // 750 + 1200
    await expect(pane.locator('#reportStatRemittedCount')).toHaveText('3');

    // Verify Table
    const table = pane.locator('#reportStatutoryRemittedTable');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('tbody')).toContainText('Income Tax');
    await expect(table.locator('tbody')).toContainText('Social Insurance Employee');
    await expect(table.locator('tbody')).toContainText('Social Insurance Employer');
  });

  test('AC 4: Payroll & Statutory Settlement Status clearly distinguishes pending vs settled across all 4 flows', async ({ page }) => {
    // Open via Report Library
    const openBtn = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Payroll & Statutory Settlement Status") button');
    await openBtn.click();

    const pane = page.locator('#reportPanePayableStatus');
    await expect(pane).toBeVisible({ timeout: 5000 });

    // Verify the 4 Money Flow Cards
    await expect(pane.locator('#badgeFlowExternal')).toHaveText('Settled');
    await expect(pane.locator('#amtFlowExternalSettled')).toContainText('$6,000.00');

    await expect(pane.locator('#badgeFlowInternal')).toHaveText('Settled');
    await expect(pane.locator('#amtFlowInternalSettled')).toContainText('$3,500.00');

    await expect(pane.locator('#badgeFlowTax')).toHaveText('Settled');
    await expect(pane.locator('#amtFlowTaxSettled')).toContainText('$1,500.00');

    await expect(pane.locator('#badgeFlowInsurance')).toHaveText('Pending');
    await expect(pane.locator('#amtFlowInsurancePending')).toContainText('$1,950.00');

    // Verify Summary Table
    const summaryTable = pane.locator('#reportPayableStatusTable');
    await expect(summaryTable).toBeVisible();
    await expect(summaryTable.locator('tbody tr')).toHaveCount(4);

    // Verify Employee Breakdown Table
    const breakdownTable = pane.locator('#reportPayableEmployeeBreakdownTable');
    await expect(breakdownTable).toBeVisible();
    await expect(breakdownTable.locator('tbody tr')).toHaveCount(3);

    // Select single employee scope
    await page.selectOption('#reportPayableEmployeeSelect', '1');
    // Summary table should still reflect the query
    await expect(summaryTable.locator('tbody tr')).toHaveCount(4);
  });

});
