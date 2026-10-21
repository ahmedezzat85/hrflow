import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// FUX-416 / FUX-421: the compensation plan is edited from the employee profile (H1/H2);
// the Salary and Raises page is a read-only overview.
async function openPlanFromProfile(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof viewProfile === 'function' && employees.length);
  await page.evaluate(() => viewProfile('EMP001'));
  await expect(page.locator('#a-employee-detail')).toHaveClass(/active/);
  await page.locator('#compEditPlanBtn').click();
  const modal = page.locator('#compensationPlanModal');
  await expect(modal).toBeVisible();
  return modal;
}

test.describe('FUX-416: Employee Compensation Plan', () => {
  test('Salary overview shows External/Internal columns and no plan or edit controls', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-salary');
    const header = page.locator('#a-salary table').first().locator('thead');
    await expect(header).toContainText('External USD');
    await expect(header).toContainText('Internal USD cash');
    await expect(header).toContainText('Monthly total');
    const firstRow = page.locator('#salaryTableBody tr').first();
    await expect(firstRow.locator('.comp-val-external')).toBeVisible();
    await expect(firstRow.locator('.comp-val-internal')).toBeVisible();
    await expect(page.locator('#salaryTableBody .btn-comp-plan, #salaryTableBody .btn-comp-ext, #salaryTableBody .btn-comp-int')).toHaveCount(0);
  });

  test('Opens Compensation Plan modal from the profile with active summary & history', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await expect(modal.locator('#compPlanModalTitle')).toContainText('Pay plan');
    await expect(modal.locator('#compPlanEmpName')).not.toBeEmpty();
    await expect(modal.locator('#compPlanActiveExternal')).toBeVisible();
    await expect(modal.locator('#compPlanActiveInternal')).toBeVisible();
    await expect(modal.locator('#compPlanInternalAmount')).toHaveValue('5000');
    await expect(modal.locator('#compPlanExternalAmount')).toHaveValue('7500');
    await modal.locator('#compPlanHistorySummary').click();
    await expect(modal.locator('#compPlanHistoryBody')).toBeVisible();
    // D-035: one row per change, Internal and External as columns (same shape as every other screen).
    await expect(modal.locator('#compPlanHistoryDetails thead th')).toHaveText(['Effective', 'Internal', 'External', 'Total', 'Change', 'Reason']);
    await expect(modal.locator('#compPlanHistoryBody tr')).toHaveCount(2);
    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
  });

  test('Raise-style change shows per-field deltas and a new total, then saves both parts at once', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await modal.locator('#compPlanInternalAmount').fill('6000');
    await modal.locator('#compPlanExternalAmount').fill('11500');
    await modal.locator('#compPlanStartDate').fill('2026-10-01');
    await expect(modal.locator('#compPlanInternalDelta')).toContainText('+$1,000');
    await expect(modal.locator('#compPlanInternalDelta')).toContainText('+20.0%');
    await expect(modal.locator('#compPlanExternalDelta')).toContainText('+$4,000');
    await expect(modal.locator('#compPlanNewTotal')).toContainText('$17,500');
    await modal.locator('#compPlanSalaryBasis').selectOption('GROSS');
    await modal.locator('#compPlanNotes').fill('Q4 Market adjustment');
    await modal.locator('#compPlanSaveBtn').click();

    await expect(modal.locator('#compPlanActiveExternal')).toContainText('11,500');
    await expect(modal.locator('#compPlanActiveInternal')).toContainText('$6,000');
    await expect(modal.locator('#compPlanIntBasis')).toContainText('Gross');
    await modal.locator('#compPlanHistorySummary').click();
    const histBody = modal.locator('#compPlanHistoryBody');
    // One new row carrying both components, not one row per component.
    await expect(histBody.locator('tr')).toHaveCount(3);
    const newRow = histBody.locator('tr').first();
    await expect(newRow).toContainText('$6,000');
    await expect(newRow).toContainText('$11,500');
    await expect(newRow).toContainText('$17,500');
    await expect(newRow).toContainText('Q4 Market adjustment');

    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator('#compExternalVal')).toContainText('11,500');
  });

  test('Setting a part to 0 ends it; both at 0 shows an inline error and disables Save', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await modal.locator('#compPlanStartDate').fill('2026-10-01');
    await modal.locator('#compPlanInternalAmount').fill('0');
    await expect(modal.locator('#compPlanInternalDelta')).toContainText('Ends this part on 2026-09-30');
    await expect(modal.locator('#compPlanBothZeroError')).toBeHidden();

    await modal.locator('#compPlanExternalAmount').fill('0');
    await expect(modal.locator('#compPlanBothZeroError')).toBeVisible();
    await expect(modal.locator('#compPlanSaveBtn')).toBeDisabled();

    await modal.locator('#compPlanExternalAmount').fill('7500');
    await expect(modal.locator('#compPlanSaveBtn')).toBeEnabled();
    await modal.locator('#compPlanSaveBtn').click();
    await expect(modal.locator('#compPlanActiveInternal')).toHaveText('$0');
    await expect(modal.locator('#compPlanActiveExternal')).toContainText('7,500');
    await modal.locator('#compPlanCloseBtn').click();
  });

  test('Server rejection appears in the dialog error summary and nothing changes', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await modal.locator('#compPlanStartDate').fill('2025-06-01');
    await modal.locator('#compPlanInternalAmount').fill('6000');
    await modal.locator('#compPlanSaveBtn').click();
    await expect(modal.locator('.form-error-summary')).toContainText('must be strictly after');
    await expect(modal.locator('#compPlanActiveInternal')).toContainText('$5,000');
    await modal.locator('#compPlanCloseBtn').click();
  });

  test('Employee with no plan sees "Set up pay plan" with empty fields and no deltas', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() => window.Router && typeof viewProfile === 'function' && employees.length);
    await page.evaluate(() => {
      FinanceMockState.compensationPlans = (FinanceMockState.compensationPlans || []).filter((p) => String(p.employee_id) !== 'EMP001');
      viewProfile('EMP001');
    });
    await page.locator('#compEditPlanBtn').click();
    const modal = page.locator('#compensationPlanModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#compPlanModalTitle')).toContainText('Set up pay plan');
    await expect(modal.locator('#compPlanInternalAmount')).toHaveValue('');
    await expect(modal.locator('#compPlanExternalAmount')).toHaveValue('');
    await expect(modal.locator('#compPlanSaveBtn')).toBeDisabled();
    await modal.locator('#compPlanExternalAmount').fill('3000');
    await expect(modal.locator('#compPlanExternalDelta')).toHaveText('');
    await modal.locator('#compPlanSaveBtn').click();
    await expect(modal.locator('#compPlanActiveExternal')).toContainText('3,000');
    await expect(modal.locator('#compPlanModalTitle')).toContainText('Pay plan');
    await modal.locator('#compPlanCloseBtn').click();
  });
});
