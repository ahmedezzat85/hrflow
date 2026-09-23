import { test, expect } from '@playwright/test';

test.describe('FUX: Employee Social Insurance and Payroll Deductions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Renders Social Insurance card in Employee Details alongside Bank Account card', async ({ page }) => {
    // Navigate to Employees directory
    await page.click('#adminSidebar a[data-page="a-employees"]');
    await expect(page.locator('#a-employees')).toBeVisible();

    // Click on the first employee row to view detail
    const firstRow = page.locator('#employeesTableBody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.locator('.icon-action[title="View Profile"]').click();

    // Verify detail page is visible
    await expect(page.locator('#a-employee-detail')).toBeVisible();

    // Check Bank Account card exists
    const bankCard = page.locator('#bankAccountCard');
    await expect(bankCard).toBeVisible();

    // Check Social Insurance card exists in Sensitive Data section
    const socialInsCard = page.locator('#socialInsuranceCard');
    await expect(socialInsCard).toBeVisible();
    await expect(socialInsCard.locator('h3')).toContainText('Social Insurance');
    await expect(socialInsCard.locator('#socialInsurancePill')).toBeVisible();
    await expect(socialInsCard.locator('#socialInsCoverage')).toBeVisible();
    await expect(socialInsCard.locator('#socialInsBase')).toBeVisible();
    await expect(socialInsCard.locator('#socialInsEffectiveDate')).toBeVisible();
  });

  test('Opens Social Insurance modal, validates future date prevention, and saves configuration', async ({ page }) => {
    // Navigate to Employees directory and open first employee
    await page.click('#adminSidebar a[data-page="a-employees"]');
    const firstRow = page.locator('#employeesTableBody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.locator('.icon-action[title="View Profile"]').click();
    await expect(page.locator('#a-employee-detail')).toBeVisible();

    // Click edit action on Social Insurance card
    const editBtn = page.locator('#socialInsuranceActionBtn');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Modal should appear
    const modal = page.locator('#socialInsuranceModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#socialInsuranceModalTitle')).toContainText('Social Insurance Configuration');

    // Attempt to set a future date
    await modal.locator('#fSocialInsFlag').check();
    await modal.locator('#fSocialInsBase').fill('4500');
    await modal.locator('#fSocialInsEffectiveDate').fill('2099-01-01');

    await modal.locator('#socialInsuranceSaveBtn').click();

    // Modal should stay open due to future date validation rejection
    await expect(modal).toBeVisible();

    // Now set a valid date (today or past)
    await modal.locator('#fSocialInsEffectiveDate').fill('2026-01-01');
    await modal.locator('#socialInsuranceSaveBtn').click();

    // Modal should close
    await expect(modal).not.toBeVisible();

    // Card should now show Covered with internal estimate label
    const socialInsCard = page.locator('#socialInsuranceCard');
    await expect(socialInsCard.locator('#socialInsurancePill')).toContainText('Covered');
    await expect(socialInsCard.locator('#socialInsCoverage')).toContainText('Covered');
    await expect(socialInsCard.locator('#socialInsBase')).toContainText('Internal Estimate');
    await expect(socialInsCard.locator('#socialInsEffectiveDate')).toContainText('2026-01-01');
  });

  test('Payroll Settings view renders statutory contribution rate inputs and allows updating', async ({ page }) => {
    // Navigate to Finance Payroll
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    // Click Payroll Settings nav link
    const settingsNavBtn = page.locator('#payrollNavSettings');
    await expect(settingsNavBtn).toBeVisible();
    await settingsNavBtn.click();

    // Settings view should be visible
    const settingsView = page.locator('#payrollViewSettings');
    await expect(settingsView).toBeVisible();

    // Verify Social Insurance Contribution Rates card exists
    const rateCard = page.locator('#payrollSocialInsuranceSettingsCard');
    await expect(rateCard).toBeVisible();
    await expect(rateCard).toContainText('Social Insurance Contribution Rates');

    const empRateInput = page.locator('#payrollEmployeeInsuranceRate');
    const empyrRateInput = page.locator('#payrollEmployerInsuranceRate');
    await expect(empRateInput).toBeVisible();
    await expect(empyrRateInput).toBeVisible();

    // Change employee rate to 12.5% and save
    await empRateInput.fill('12.50');
    await page.click('#payrollViewSettings .save-bar button.btn-primary');

    // Should return to list view with success banner
    await expect(page.locator('#payrollViewList')).toBeVisible();
  });

  test('Worksheet table displays Deductions (Est.) column with internal estimate title', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    // Open current cycle to view worksheet
    await page.click('#btnOpenCurrentCycle');
    await expect(page.locator('#payrollViewRun')).toBeVisible();

    // Verify worksheet table header for Deductions contains (Est.)
    const tableHeader = page.locator('#payrollWorksheetTable thead');
    await expect(tableHeader).toContainText('Deductions (Est.)');

    // Verify header title has estimate indicator
    const deductionTh = tableHeader.locator('th:has-text("Deductions (Est.)")');
    await expect(deductionTh).toHaveAttribute('title', /Internal Estimate/);

    // Verify footer total deductions cell has estimate title
    const deductionFooter = page.locator('#fDeductions');
    await expect(deductionFooter).toHaveAttribute('title', /Internal Estimate/);
  });

  test('Regression fix: Employee profile card renders with header and compensation grid', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-employees"]');
    await expect(page.locator('#a-employees')).toBeVisible();

    const firstRow = page.locator('#employeesTableBody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.locator('.icon-action[title="View Profile"]').click();

    await expect(page.locator('#a-employee-detail')).toBeVisible();

    // Verify detailProfileHead is populated
    const profileHead = page.locator('#detailProfileHead');
    await expect(profileHead).toBeVisible();
    await expect(profileHead.locator('.esc-identity h4')).not.toBeEmpty();
    await expect(profileHead.locator('.esc-avatar')).toBeVisible();

    // Verify detailInfoGrid is populated with compensation & info items
    const infoGrid = page.locator('#detailInfoGrid');
    await expect(infoGrid).toBeVisible();
    await expect(infoGrid.locator('.esc-body')).toBeVisible();
    await expect(infoGrid).toContainText('Monthly Compensation');
  });

  test('Regression fix: Employee edit button in table opens edit modal with prefilled data', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-employees"]');
    await expect(page.locator('#a-employees')).toBeVisible();

    const firstRow = page.locator('#employeesTableBody tr').first();
    await expect(firstRow).toBeVisible();

    // Click edit button
    const editBtn = firstRow.locator('.icon-action[title="Edit"]');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Expect modal to be open and prefilled
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#empModalTitle')).toContainText('Edit Employee');
    await expect(modal.locator('#fEmpName')).not.toBeEmpty();

    // Close modal cleanly
    await modal.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('Regression fix: Viewport and sidebar layout containment prevents window scroll cut-off', async ({ page }) => {
    // Check that html/body has overflow hidden and window scroll is 0
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    const isWindowScrollable = await page.evaluate(() => {
      return document.documentElement.scrollHeight > window.innerHeight;
    });
    expect(isWindowScrollable).toBe(false);

    // Verify sidebar-nav exists and is scrollable container
    const sidebarNav = page.locator('#adminSidebar .sidebar-nav');
    await expect(sidebarNav).toBeVisible();
    const navOverflowY = await sidebarNav.evaluate(el => window.getComputedStyle(el).overflowY);
    expect(navOverflowY).toBe('auto');
  });
});
