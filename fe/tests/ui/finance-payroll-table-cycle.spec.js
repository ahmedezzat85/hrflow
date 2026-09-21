import { test, expect } from '@playwright/test';

test.describe('HRFlow Redesigned Payroll Module — Table, Cycle & Verification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    // Ensure deterministic clean state for 2026-09
    await page.evaluate(() => {
      if (typeof PayrollCycleManager !== 'undefined') {
        PayrollCycleManager.resetCycle('2026-09');
      }
      if (typeof PayrollTableController !== 'undefined') {
        PayrollTableController.loadData('2026-09');
        PayrollTableController.render();
      }
    });
  });

  test('Goals 1, 3, 4: Table renders required columns, 15 seed employees across 3 groups, and pinned totals row', async ({ page }) => {
    // Check Cycle Bar and Status Stepper
    await expect(page.locator('#payrollStep_draft')).toBeVisible();
    await expect(page.locator('#payrollStep_draft')).toHaveClass(/active/);
    await expect(page.locator('#payrollCycleCurrentBadge')).toHaveText('DRAFT');

    // Check Table presence and headers
    const table = page.locator('#payrollWorksheetTable');
    await expect(table).toBeVisible();

    const headers = table.locator('thead th');
    await expect(headers.nth(0)).toContainText('Employee');
    await expect(headers.nth(1)).toContainText('Base Salary');
    await expect(headers.nth(2)).toContainText('Overtime');
    await expect(headers.nth(3)).toContainText('Bonus');
    await expect(headers.nth(4)).toContainText('Sales Comm.');
    await expect(headers.nth(5)).toContainText('Supp. Comm.');
    await expect(headers.nth(6)).toContainText('Source');
    await expect(headers.nth(7)).toContainText('Deductions');
    await expect(headers.nth(8)).toContainText('Net Pay');

    // 3 Account Groups should be rendered
    await expect(table.locator('.payroll-group-header-row')).toHaveCount(3);
    await expect(table.locator('.payroll-group-header-row').nth(0)).toContainText('Operations');
    await expect(table.locator('.payroll-group-header-row').nth(1)).toContainText('Engineering');
    await expect(table.locator('.payroll-group-header-row').nth(2)).toContainText('Sales & Marketing');

    // 15 employee rows
    await expect(table.locator('.payroll-row')).toHaveCount(15);

    // 3 Per-Account Totals rows + 1 Grand Total row
    await expect(table.locator('.payroll-group-totals-row')).toHaveCount(3);
    await expect(table.locator('.payroll-grand-totals-row')).toBeVisible();
    await expect(page.locator('#grandTotalNet')).toBeVisible();
  });

  test('Goal 1: Inline cell editing for Bonus, Sales Commission, and Support Commission with live recompute', async ({ page }) => {
    // Target Sarah Connor (EMP001) in Engineering
    const row = page.locator('#payrollRow_EMP001');
    await expect(row).toBeVisible();

    const bonusCell = row.locator('.payroll-editable-cell[data-field="bonus"]');
    const netCell = page.locator('#netPayDisplay_EMP001');

    const initialNetText = await netCell.innerText();

    // Click bonus cell to activate inline input
    await bonusCell.click();
    const input = bonusCell.locator('input.payroll-inline-input');
    await expect(input).toBeVisible();

    // Type new bonus value 2500 and press Enter
    await input.fill('2500');
    await input.press('Enter');

    // Expect input removed and display text updated
    await expect(bonusCell.locator('input')).toHaveCount(0);
    await expect(bonusCell.locator('#cellDisplay_EMP001_bonus')).toHaveText('$2,500.00');
    await expect(bonusCell).toHaveClass(/payroll-cell-edited/);

    // Net pay should increase
    const updatedNetText = await netCell.innerText();
    expect(updatedNetText).not.toEqual(initialNetText);

    // Test Escape cancels editing without committing
    const salesCell = row.locator('.payroll-editable-cell[data-field="salesComm"]');
    const initialSales = await salesCell.innerText();
    await salesCell.click();
    const salesInput = salesCell.locator('input.payroll-inline-input');
    await salesInput.fill('9999');
    await salesInput.press('Escape');
    await expect(salesCell.locator('input')).toHaveCount(0);
    await expect(salesCell).toContainText(initialSales);
  });

  test('Goal 2: INT / EXT source toggle muting and filter integration', async ({ page }) => {
    // Check initial row source
    const row = page.locator('#payrollRow_EMP001');
    const toggleBtn = row.locator('#btnSourceToggle_EMP001');
    await expect(toggleBtn).toHaveText('INT');
    await expect(row).not.toHaveClass(/payroll-row-ext/);

    // Click toggle to switch to EXT
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText('EXT');
    await expect(row).toHaveClass(/payroll-row-ext/);

    // Filter by Source = EXT
    await page.selectOption('#payrollSourceFilter', 'EXT');
    // All visible rows should be EXT
    const visibleRows = page.locator('#payrollWorksheetTable .payroll-row');
    const count = await visibleRows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(visibleRows.nth(i).locator('.source-chip')).toHaveText('EXT');
    }

    // Reset filter to All
    await page.selectOption('#payrollSourceFilter', 'all');
  });

  test('Goal 5: Full Cycle workflow Draft -> Review -> Approved -> Paid with confirmation modals and lock enforcement', async ({ page }) => {
    // 1. Submit for Review
    const btnSubmit = page.locator('#btnPayrollSubmitReview');
    await expect(btnSubmit).toBeVisible();
    await btnSubmit.click();

    // Confirmation modal appears
    const confirmModal = page.locator('#financeConfirmModal');
    await expect(confirmModal).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(confirmModal).not.toBeVisible();

    // Step status becomes REVIEW
    await expect(page.locator('#payrollStep_review')).toHaveClass(/active/);
    await expect(page.locator('#payrollCycleCurrentBadge')).toHaveText('REVIEW');

    // 2. Approve cycle (admin role)
    const btnApprove = page.locator('#btnPayrollApprove');
    await expect(btnApprove).toBeVisible();
    await btnApprove.click();

    await expect(confirmModal).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(confirmModal).not.toBeVisible();

    // Step status becomes APPROVED
    await expect(page.locator('#payrollStep_approved')).toHaveClass(/active/);
    await expect(page.locator('#payrollCycleCurrentBadge')).toHaveText('APPROVED');

    // Table should now be locked!
    await expect(page.locator('#payrollTableLockBanner')).toBeVisible();
    const lockedCell = page.locator('#payrollRow_EMP001 .payroll-editable-cell').first();
    await expect(lockedCell).toHaveAttribute('tabindex', '-1');

    // 3. Mark as Paid
    const btnPaid = page.locator('#btnPayrollMarkPaid');
    await expect(btnPaid).toBeVisible();
    await btnPaid.click();

    await expect(confirmModal).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(confirmModal).not.toBeVisible();

    // Step status becomes PAID
    await expect(page.locator('#payrollStep_paid')).toHaveClass(/active/);
    await expect(page.locator('#payrollCycleCurrentBadge')).toHaveText('PAID');

    // 4. Reopen Draft
    const btnReopen = page.locator('#btnPayrollReopenDraft');
    await expect(btnReopen).toBeVisible();
    await btnReopen.click();

    await expect(confirmModal).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(confirmModal).not.toBeVisible();

    // Returns to DRAFT and table is unlocked
    await expect(page.locator('#payrollStep_draft')).toHaveClass(/active/);
    await expect(page.locator('#payrollCycleCurrentBadge')).toHaveText('DRAFT');
    await expect(page.locator('#payrollTableLockBanner')).not.toBeVisible();
  });

  test('Goal 6: Export to Excel and PDF dropdown menu works', async ({ page }) => {
    const exportBtn = page.locator('#btnPayrollExportMenu');
    await expect(exportBtn).toBeVisible();

    // Open dropdown
    await exportBtn.click();
    const dropdownMenu = page.locator('#payrollExportMenuContent');
    await expect(dropdownMenu).toBeVisible();

    // Verify both export choices exist
    await expect(dropdownMenu.locator('text=Export to Excel (.csv)')).toBeVisible();
    await expect(dropdownMenu.locator('text=Export to PDF / Print')).toBeVisible();
  });

  test('Goal 7 & 8: Dark mode and 375px mobile viewport rendering', async ({ page }) => {
    // Toggle dark mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.setAttribute('data-theme', 'dark');
    });
    await expect(page.locator('#payrollWorksheetTable')).toBeVisible();

    // Resize viewport to 375px width (iPhone standard mobile width)
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('#payrollWorksheetTable')).toBeVisible();
    await expect(page.locator('.payroll-table-wrapper')).toBeVisible();
  });
});
