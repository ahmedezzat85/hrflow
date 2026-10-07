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
    await expect(header).toContainText('Internal USD Cash');
    await expect(header).toContainText('Total Monthly');
    const firstRow = page.locator('#salaryTableBody tr').first();
    await expect(firstRow.locator('.comp-val-external')).toBeVisible();
    await expect(firstRow.locator('.comp-val-internal')).toBeVisible();
    await expect(page.locator('#salaryTableBody .btn-comp-plan, #salaryTableBody .btn-comp-ext, #salaryTableBody .btn-comp-int')).toHaveCount(0);
  });

  test('Opens Compensation Plan modal from the profile with active summary & history', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await expect(modal.locator('#compPlanModalTitle')).toContainText('Employee Compensation Plan');
    await expect(modal.locator('#compPlanEmpName')).not.toBeEmpty();
    await expect(modal.locator('#compPlanActiveExternal')).toBeVisible();
    await expect(modal.locator('#compPlanActiveInternal')).toBeVisible();
    await expect(modal.locator('#compPlanHistoryBody')).toBeVisible();
    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
  });

  test('Saving an External USD change updates the modal and the profile card', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await modal.locator('#compPlanComponentType').selectOption('external_usd');
    await modal.locator('#compPlanAmount').fill('11500');
    await modal.locator('#compPlanStartDate').fill('2026-10-01');
    await modal.locator('#compPlanNotes').fill('Q4 Market adjustment');
    await modal.locator('#compPlanSaveBtn').click();

    await expect(modal.locator('#compPlanActiveExternal')).toContainText('11,500');
    const histBody = modal.locator('#compPlanHistoryBody');
    await expect(histBody).toContainText('11,500');
    await expect(histBody).toContainText('Q4 Market adjustment');

    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator('#compExternalVal')).toContainText('11,500');
  });

  test('FUX-421: internal_usd_cash shows Salary Basis selector and saves GROSS basis', async ({ page }) => {
    const modal = await openPlanFromProfile(page);
    await modal.locator('#compPlanComponentType').selectOption('internal_usd_cash');
    const basisContainer = modal.locator('#compPlanSalaryBasisContainer');
    await expect(basisContainer).toBeVisible();
    await modal.locator('#compPlanSalaryBasis').selectOption('GROSS');

    await modal.locator('#compPlanAmount').fill('6500');
    await modal.locator('#compPlanStartDate').fill('2026-10-01');
    await modal.locator('#compPlanNotes').fill('Internal Gross basis test');
    await modal.locator('#compPlanSaveBtn').click();

    await expect(modal.locator('#compPlanActiveInternal')).toContainText('GROSS');
    await expect(modal.locator('#compPlanHistoryBody')).toContainText('GROSS');

    await modal.locator('#compPlanComponentType').selectOption('external_usd');
    await expect(basisContainer).not.toBeVisible();
    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
  });
});
