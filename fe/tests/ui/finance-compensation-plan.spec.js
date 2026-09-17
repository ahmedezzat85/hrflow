import { test, expect } from '@playwright/test';

test.describe('FUX-416: Employee Compensation Plan', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.click('#adminSidebar a[data-page="a-salary"]');
    await expect(page.locator('#a-salary')).toBeVisible();
  });


  test('Renders separate External USD and Internal USD Cash columns with Plan action', async ({ page }) => {
    // Check table headers
    const tableHeader = page.locator('#a-salary table').first().locator('thead');
    await expect(tableHeader).toContainText('External USD');
    await expect(tableHeader).toContainText('Internal USD Cash');
    await expect(tableHeader).toContainText('Total Monthly');

    // Check table body rows exist
    const tbody = page.locator('#salaryTableBody');
    await expect(tbody).toBeVisible();

    // Verify first row contains external/internal values and plan edit buttons
    const firstRow = tbody.locator('tr').first();
    await expect(firstRow.locator('.comp-val-external')).toBeVisible();
    await expect(firstRow.locator('.comp-val-internal')).toBeVisible();
    await expect(firstRow.locator('.btn-comp-plan')).toBeVisible();
  });

  test('Opens Compensation Plan modal and displays active plan summary & history', async ({ page }) => {
    const tbody = page.locator('#salaryTableBody');
    const firstRow = tbody.locator('tr').first();

    // Click "Plan" button in actions column
    await firstRow.locator('.btn-comp-plan').click();

    const modal = page.locator('#compensationPlanModal');
    await expect(modal).toBeVisible();

    // Check modal header and active summary
    await expect(modal.locator('#compPlanModalTitle')).toContainText('Employee Compensation Plan');
    await expect(modal.locator('#compPlanEmpName')).not.toBeEmpty();
    await expect(modal.locator('#compPlanActiveExternal')).toBeVisible();
    await expect(modal.locator('#compPlanActiveInternal')).toBeVisible();

    // Check history table rendered
    const histBody = modal.locator('#compPlanHistoryBody');
    await expect(histBody).toBeVisible();

    // Close modal
    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();
  });

  test('Clicking edit icon on External USD pre-selects external_usd in modal and updates component', async ({ page }) => {
    const tbody = page.locator('#salaryTableBody');
    const firstRow = tbody.locator('tr').first();

    // Click edit button for external USD
    await firstRow.locator('.btn-comp-ext').click();

    const modal = page.locator('#compensationPlanModal');
    await expect(modal).toBeVisible();

    // Verify component type is selected as external_usd
    const typeSelect = modal.locator('#compPlanComponentType');
    await expect(typeSelect).toHaveValue('external_usd');

    // Set new amount and submit
    await modal.locator('#compPlanAmount').fill('11500');
    await modal.locator('#compPlanStartDate').fill('2026-10-01');
    await modal.locator('#compPlanNotes').fill('Q4 Market adjustment');

    await modal.locator('#compPlanSaveBtn').click();

    // Check toast notification and updated modal active summary
    await expect(modal.locator('#compPlanActiveExternal')).toContainText('11,500');

    // History body should contain new active entry
    const histBody = modal.locator('#compPlanHistoryBody');
    await expect(histBody).toContainText('11,500');
    await expect(histBody).toContainText('Q4 Market adjustment');

    // Close modal
    await modal.locator('#compPlanCloseBtn').click();
    await expect(modal).not.toBeVisible();

    // Confirm salary table reflects updated external USD amount
    await expect(firstRow.locator('.comp-val-external')).toContainText('11,500');
  });
});

