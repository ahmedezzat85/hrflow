
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

  test('AC 1 & AC 2: 4-Step Net Payment Runner executes setup, review payments, readiness check, confirm and submit', async ({ page }) => {
    // 1. Check KPI cards and table
    await expect(page.locator('#kpiLastRunNet')).toBeVisible();
    await expect(page.locator('#kpiActiveStaff')).toBeVisible();
    await expect(page.locator('#financePayrollTable')).toBeVisible();

    // 2. Click "Run Payroll" button to launch runner
    await page.click('#btnRunPayrollWizard');
    const wizardModal = page.locator('#runPayrollWizardModal');
    await expect(wizardModal).toBeVisible();

    // Step 1: Period, Dates & Funding Selection
    await expect(page.locator('#wizardStep1')).toBeVisible();
    await page.fill('#wizardPeriodLabel', '2026-09');
    await page.click('#wizardNextBtn');

    // Step 2: Review Payments (grouped by recipient)
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await expect(page.locator('#wizardReviewRecipientCount')).toHaveText('2');
    await expect(page.locator('#wizardEmployeesPreviewTableBody tr')).toHaveCount(2);
    await page.click('#wizardNextBtn');

    // Step 3: Resolve Readiness Issues
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await expect(page.locator('#wizardExceptionsClean')).toBeVisible();
    await page.click('#wizardNextBtn');

    // Step 4: Confirm and Submit for Approval
    await expect(page.locator('#wizardStep4')).toBeVisible();
    await expect(page.locator('#wizardConfirmNetTotal')).toBeVisible();
    await expect(page.locator('#wizardConfirmHeadcount')).toHaveText('2');
    await page.click('#btnWizardSubmitForApproval');

    // Wizard closes and Run Detail Drawer/Modal opens
    await expect(wizardModal).not.toBeVisible();
    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();
    await expect(detailModal.locator('#runDetailTitle')).toContainText('2026-09');
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('SUBMITTED');
  });

  test('AC 3 & AC 4: Run lifecycle transitions (Submit -> Approve -> Finalize -> Disburse -> Post Net Journal) and generates payment receipt', async ({ page }) => {
    // Open existing run from table
    const detailsBtn = page.locator('#financePayrollTableBody button').first();
    await expect(detailsBtn).toBeVisible({ timeout: 5000 });
    await detailsBtn.click();

    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();

    // In mock, run 1 is already paid, let's close detail and launch wizard to create a fresh submitted run
    await page.click('#payrollRunDetailModal .modal-close');
    await expect(detailModal).not.toBeVisible();

    // Launch wizard
    await page.click('#btnRunPayrollWizard');
    await page.fill('#wizardPeriodLabel', '2026-10');
    // Step 1 -> 2 -> 3 -> 4
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep4')).toBeVisible();

    // Submit for Approval
    await page.click('#btnWizardSubmitForApproval');
    await expect(detailModal).toBeVisible();

    // Approve the submitted run
    const approveBtn = detailModal.locator('#btnRunDetailApprove');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('APPROVED');

    // Once approved, "Finalize Run" button is visible
    const finalizeBtn = detailModal.locator('#btnRunDetailFinalize');
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('FINALIZED');

    // Once finalized, "Fund & Disburse" button becomes visible
    const disburseBtn = detailModal.locator('#btnRunDetailDisburse');
    await expect(disburseBtn).toBeVisible();
    await disburseBtn.click();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('PAID');

    // Once disbursed, "Post Net Journal" button becomes visible
    const postJournalBtn = detailModal.locator('#btnRunDetailPostJournal');
    await expect(postJournalBtn).toBeVisible();
    await postJournalBtn.click();
    await expect(postJournalBtn).toContainText('GL Journal Posted');

    // Click payment receipt button on first line item in detail table
    const receiptBtn = detailModal.locator('#runDetailLinesTableBody button.btn-view-payslip').first();
    await expect(receiptBtn).toBeVisible();
    await receiptBtn.click();

    // Itemized employee payment receipt modal should be visible
    const receiptModal = page.locator('#employeePayslipModal');
    await expect(receiptModal).toBeVisible();
    await expect(receiptModal.locator('#payslipEmpName')).toContainText('Sarah Connor');
    await expect(receiptModal.locator('#payslipNetPay')).toContainText('$15,000.00');
    await expect(receiptModal.locator('#payslipStatusChip')).toContainText('PAID');

    // Close receipt modal
    await receiptModal.locator('.modal-close').click();
    await expect(receiptModal).not.toBeVisible();

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
