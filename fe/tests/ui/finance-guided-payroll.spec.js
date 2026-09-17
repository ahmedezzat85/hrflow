import { test, expect } from '@playwright/test';

test.describe('Story 8.1: Guided Payroll Run', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Guided Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
  });

  test('AC 1 & AC 2: Guided 5-Step Payroll Wizard executes readiness check, variances, exceptions, liabilities, and creates run', async ({ page }) => {
    // 1. Check KPI cards and table
    await expect(page.locator('#kpiLastRunNet')).toBeVisible();
    await expect(page.locator('#kpiActiveStaff')).toBeVisible();
    await expect(page.locator('#financePayrollTable')).toBeVisible();

    // 2. Click "Run Payroll" button to launch wizard
    await page.click('#btnRunPayrollWizard');
    const wizardModal = page.locator('#runPayrollWizardModal');
    await expect(wizardModal).toBeVisible();

    // Step 1: Period & Bank Selection
    await expect(page.locator('#wizardStep1')).toBeVisible();
    await page.fill('#wizardPeriodLabel', '2026-09');
    await page.click('#wizardNextBtn');

    // Step 2: Review Headcount & Variances Preview
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await expect(page.locator('#wizardVarianceHeadcount')).toHaveText('2');
    await expect(page.locator('#wizardEmployeesPreviewTableBody tr')).toHaveCount(2);
    await page.click('#wizardNextBtn');

    // Step 3: Exceptions & Readiness
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await expect(page.locator('#wizardExceptionsClean')).toBeVisible();
    await page.click('#wizardNextBtn');

    // Step 4: Liabilities & Balanced Double-Entry Journal Preview
    await expect(page.locator('#wizardStep4')).toBeVisible();
    await expect(page.locator('#wizardJournalBalancedBadge')).toContainText('Balanced');
    await expect(page.locator('#wizardJournalTableBody tr')).toHaveCount(5);
    await page.click('#wizardNextBtn');

    // Step 5: Maker-Checker Finalization & Create Run
    await expect(page.locator('#wizardStep5')).toBeVisible();
    await page.click('#btnWizardCreateAndApprove');

    // Wizard should close and Run Detail Modal should open
    await expect(wizardModal).not.toBeVisible();
    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();
    await expect(detailModal.locator('#runDetailTitle')).toContainText('2026-09');
  });

  test('AC 3 & AC 4: Run lifecycle transitions (Finalize -> Disburse -> Post GL Journal) and generates itemized payslips', async ({ page }) => {
    // Open existing run from table
    const detailsBtn = page.locator('#financePayrollTableBody button').first();
    await expect(detailsBtn).toBeVisible({ timeout: 5000 });
    await detailsBtn.click();

    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();

    // In mock, run 1 is already paid, let's close detail and launch wizard to create a fresh approved run
    await page.click('#payrollRunDetailModal .modal-close');
    await expect(detailModal).not.toBeVisible();

    // Launch wizard
    await page.click('#btnRunPayrollWizard');
    await page.fill('#wizardPeriodLabel', '2026-10');
    // Step 1 -> 2 -> 3 -> 4 -> 5
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep4')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep5')).toBeVisible();

    // Create & Approve Run
    await page.click('#btnWizardCreateAndApprove');
    await expect(detailModal).toBeVisible();

    // The newly created run is APPROVED, so "Finalize Run" button is visible
    const finalizeBtn = detailModal.locator('#btnRunDetailFinalize');
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();

    // Once finalized, "Fund & Disburse" button becomes visible
    const disburseBtn = detailModal.locator('#btnRunDetailDisburse');
    await expect(disburseBtn).toBeVisible();
    await disburseBtn.click();

    // Once disbursed, "Post GL Journal" button becomes visible
    const postJournalBtn = detailModal.locator('#btnRunDetailPostJournal');
    await expect(postJournalBtn).toBeVisible();
    await postJournalBtn.click();
    await expect(postJournalBtn).toContainText('GL Journal Posted');

    // Click payslip button on first line item in detail table
    const payslipBtn = detailModal.locator('#runDetailLinesTableBody button[title="View Payslip"]').first();
    await expect(payslipBtn).toBeVisible();
    await payslipBtn.click();

    // Itemized employee payslip modal should be visible
    const payslipModal = page.locator('#employeePayslipModal');
    await expect(payslipModal).toBeVisible();
    await expect(payslipModal.locator('#payslipEmpName')).toContainText('Sarah Connor');
    await expect(payslipModal.locator('#payslipNetPay')).toContainText('$12,750.00');
    await expect(payslipModal.locator('#payslipStatusChip')).toContainText('PAID');

    // Close payslip modal
    await payslipModal.locator('.modal-close').click();
    await expect(payslipModal).not.toBeVisible();

    // Close detail modal
    await detailModal.locator('.modal-close').click();
    await expect(detailModal).not.toBeVisible();

    // Verify filter input
    await page.fill('#financePayrollSearch', '2026-10');
    const rows = page.locator('#financePayrollTableBody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2026-10');
  });
});
