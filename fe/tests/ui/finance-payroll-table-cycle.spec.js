import { test, expect } from '@playwright/test';

test.describe('HRFlow Fresh From-Scratch In-Page Payroll Module', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
  });

  test('TC-1: In-Page Architecture — Runs List (History), Run Page, and Settings without modals', async ({ page }) => {
    // Topbar brand and sub-navigation tabs should be visible
    await expect(page.locator('#payrollNavList')).toBeVisible();
    await expect(page.locator('#payrollNavSettings')).toBeVisible();

    // Starts on Runs List / History page by default
    const viewList = page.locator('#payrollViewList');
    await expect(viewList).toBeVisible();
    await expect(viewList.locator('#payrollRunsTable')).toBeVisible();
    await expect(viewList.locator('#payrollRunsCount')).toContainText('runs');

    // History table contains current cycle and past cycles
    const runsRows = viewList.locator('#payrollRunsTableBody tr');
    await expect(runsRows).toHaveCount(4);
    await expect(runsRows.first()).toContainText('2026-09');

    // Click "Open current cycle" to open the Run page in-place (NOT a modal)
    await page.click('#btnOpenCurrentCycle');
    await expect(viewList).toHaveClass(/payroll-hidden/);

    const viewRun = page.locator('#payrollViewRun');
    await expect(viewRun).toBeVisible();
    await expect(page.locator('#runPayrollWizardModal')).toHaveCount(0); // Old wizard modal should not exist

    // Back to All runs button returns to Runs List
    await page.click('#payrollViewRun button:has-text("All runs")');
    await expect(viewList).toBeVisible();
    await expect(viewRun).toHaveClass(/payroll-hidden/);

    // Switch to Settings Page via topbar
    await page.click('#payrollNavSettings');
    const viewSettings = page.locator('#payrollViewSettings');
    await expect(viewSettings).toBeVisible();
    await expect(viewList).toHaveClass(/payroll-hidden/);
    await expect(page.locator('#payrollTargetExternalAccount')).toBeVisible();
    await expect(page.locator('#payrollTargetInternalAccount')).toBeVisible();
    await expect(page.locator('#payrollSetMonth')).toHaveValue('2026-09');

    // Cancel in Settings returns to Runs List
    await page.click('#payrollViewSettings button:has-text("Cancel")');
    await expect(viewList).toBeVisible();
  });

  test('TC-2: Run Page — Stepper, 5 KPI cards, worksheet table, inline bonuses, and bottom panels', async ({ page }) => {
    // Open Run Page
    await page.click('#btnOpenCurrentCycle');
    const viewRun = page.locator('#payrollViewRun');
    await expect(viewRun).toBeVisible();

    // 1. Check Stepper
    const stepper = page.locator('#payrollStepper');
    await expect(stepper.locator('.payroll-step-pill')).toHaveCount(4);
    await expect(stepper.locator('.payroll-step-pill.active')).toContainText('1. Review & Draft');

    // 2. Check 5 KPI Stat cards
    const stats = page.locator('#payrollStatsGrid .payroll-stat');
    await expect(stats).toHaveCount(5);
    await expect(stats.nth(0).locator('.label')).toHaveText(/Headcount/i);
    await expect(stats.nth(1).locator('.label')).toHaveText(/Total Net Payment/i);

    // 3. Check Worksheet table columns and rows
    const table = page.locator('#payrollWorksheetTable');
    await expect(table).toBeVisible();
    const rows = table.locator('#payrollTableBody tr:not(.expand-row)');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // 4. Test adding inline bonus to first employee
    const firstRow = rows.first();
    const empName = await firstRow.locator('.payroll-emp-name').textContent();
    const empIdText = await firstRow.locator('.payroll-emp-id').textContent();
    const empId = empIdText.replace('#', '').trim();

    await firstRow.locator('.add-bonus-btn').click();

    // Expand row appears
    const expandRow = table.locator('.expand-row');
    await expect(expandRow).toBeVisible();

    // Verify fields and buttons are aligned in a single horizontal row
    const formRow = expandRow.locator('.expand-form-row');
    await expect(formRow).toBeVisible();
    const submitBtn = expandRow.locator('.btn-bonus-submit');
    const closeBtn = expandRow.locator('.btn-bonus-close');
    await expect(submitBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();
    const submitBox = await submitBtn.boundingBox();
    expect(submitBox.width).toBeLessThan(160); // Not stretched to full row width

    await expandRow.locator(`#amt-${empId}`).fill('500');
    // Toggle source to External
    await expandRow.locator(`#src-${empId} button[data-src="external"]`).click();
    await submitBtn.click();

    // Verify bonus tag created
    await expect(expandRow.locator('.bonus-tag')).toContainText('$500.00');

    // 5. Verify ID in first column, employee name wrapping in second column
    const firstRowCells = firstRow.locator('td');
    await expect(firstRowCells.nth(0)).toHaveClass(/payroll-id-col/);
    await expect(firstRowCells.nth(1)).toHaveClass(/payroll-name-col/);
    const empNameWhiteSpace = await firstRow.locator('.payroll-emp-name').evaluate(el => window.getComputedStyle(el).whiteSpace);
    expect(empNameWhiteSpace).toBe('normal');

    // 6. Verify single outer scroll (no inner vertical table scroll and no horizontal scroll on desktop)
    const tableWrapScrollState = await page.locator('#payrollViewRun .payroll-table-wrap').evaluate(el => ({
      hasVerticalScroll: el.scrollHeight > el.clientHeight,
      hasHorizontalScroll: el.scrollWidth > el.clientWidth + 2
    }));
    expect(tableWrapScrollState.hasVerticalScroll).toBe(false);
    expect(tableWrapScrollState.hasHorizontalScroll).toBe(false);

    // 6. Check compact bottom summary strip
    await expect(page.locator('#accExternal')).toBeVisible();
    await expect(page.locator('#accInternal')).toBeVisible();
    await expect(page.locator('#payrollExceptionList')).toBeVisible();
    // Journal card should remain hidden before paid
    await expect(page.locator('#payrollJournalCard')).toHaveClass(/payroll-hidden/);
  });

  test('TC-3: Step lifecycle (Draft -> Approved -> Processing -> Paid), exception handling, and Revert to Draft', async ({ page }) => {
    // Open Run Page
    await page.click('#btnOpenCurrentCycle');

    // Journal should be hidden initially
    await expect(page.locator('#payrollJournalCard')).toHaveClass(/payroll-hidden/);

    // Advance to Step 2: Approved
    await page.click('#payrollNextBtn');
    await expect(page.locator('#payrollStatusBadge')).toHaveText('APPROVED');
    await expect(page.locator('#payrollLockNote')).toBeVisible();

    // Advance to Step 3: Processing (simulates bank failure)
    await page.click('#payrollNextBtn');
    await expect(page.locator('#payrollStatusBadge')).toHaveText('PROCESSING');

    // Verify exception appears under Exceptions strip
    const exceptionsPanel = page.locator('#payrollExceptionList');
    await expect(exceptionsPanel).toContainText('Bank transfer rejected');

    // Attempting next when blocking exception exists is prevented
    await expect(page.locator('#payrollNextBtn')).toBeDisabled();

    // Click "Retry payment" on the exception
    await page.click('.retry-btn');
    await expect(page.locator('#payrollActionBanner')).toContainText('Payment retried for');

    // Advance to Step 4: Paid
    await expect(page.locator('#payrollNextBtn')).not.toBeDisabled();
    await page.click('#payrollNextBtn');
    await expect(page.locator('#payrollStatusBadge')).toHaveText('PAID');
    await expect(page.locator('#payrollNextBtn')).toHaveText('Cycle Complete');

    // Now Journal card becomes visible automatically once PAID
    const journalCard = page.locator('#payrollJournalCard');
    await expect(journalCard).toBeVisible();
    await expect(journalCard.locator('#payrollJournalBadge')).toHaveText('Posted');

    // Toggle journal lines
    await page.click('#btnToggleJournal');
    await expect(page.locator('#payrollJournalDetails')).toBeVisible();
    await expect(page.locator('#payrollJournalRows')).toContainText('Internal Payroll Expense');

    // Test Revert to Draft
    await page.click('#payrollRevertBtn');
    const revertModal = page.locator('#payrollRevertModal');
    await expect(revertModal).toHaveClass(/show/);

    await page.fill('#payrollRevertReason', 'Correction needed for overtime hours');
    await page.click('#payrollRevertModal button:has-text("Revert to draft")');

    await expect(revertModal).not.toHaveClass(/show/);
    await expect(page.locator('#payrollStatusBadge')).toHaveText('DRAFT');
    await expect(page.locator('#payrollLockNote')).toHaveClass(/payroll-hidden/);
    await expect(page.locator('#payrollJournalCard')).toHaveClass(/payroll-hidden/);
  });

  test('TC-4: Settings Page — Target funding accounts selection and payroll month schedule update', async ({ page }) => {
    await page.click('#payrollNavSettings');
    await expect(page.locator('#payrollViewSettings')).toBeVisible();

    // Verify two cells for choosing target account for External and Internal salaries
    const extSelect = page.locator('#payrollTargetExternalAccount');
    const intSelect = page.locator('#payrollTargetInternalAccount');
    await expect(extSelect).toBeVisible();
    await expect(intSelect).toBeVisible();

    // Verify options are populated from company bank accounts
    const extOptions = extSelect.locator('option');
    const intOptions = intSelect.locator('option');
    await expect(extOptions).not.toHaveCount(0);
    await expect(intOptions).not.toHaveCount(0);

    // Select target accounts
    const extFirstVal = await extOptions.first().getAttribute('value');
    if (extFirstVal) {
      await extSelect.selectOption(extFirstVal);
    }
    const intLastVal = await intOptions.last().getAttribute('value');
    if (intLastVal) {
      await intSelect.selectOption(intLastVal);
    }

    // Change Month schedule
    await page.fill('#payrollSetMonth', '2026-10');
    await page.click('button:has-text("Save settings")');

    // Redirects to runs list and displays confirmation
    await expect(page.locator('#payrollViewList')).toBeVisible();
    await expect(page.locator('#payrollActionBanner')).toContainText('Payroll settings saved');
  });
});
