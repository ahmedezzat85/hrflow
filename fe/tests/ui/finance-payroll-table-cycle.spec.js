import { test, expect } from '@playwright/test';

test.describe('HRFlow Six-Screen Payroll Journey & Lifecycle Cycle', () => {
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

  test('TC-2: Stepper (6 steps), Screen 1 (Initiation: FX & Period), and Screen 2 (Approve & Bonuses)', async ({ page }) => {
    // Open Run Page
    await page.click('#btnOpenCurrentCycle');
    const viewRun = page.locator('#payrollViewRun');
    await expect(viewRun).toBeVisible();

    // 1. Check Stepper: 6 purpose-built steps
    const stepper = page.locator('#payrollStepper');
    await expect(stepper.locator('.payroll-step-pill')).toHaveCount(6);
    await expect(stepper.locator('.payroll-step-pill.active')).toContainText('1. Initiation');

    // 2. Screen 1 elements visible
    const s1 = page.locator('#payrollScreen1');
    await expect(s1).toBeVisible();
    await expect(page.locator('#p1Month')).toHaveValue('2026-09');
    await expect(page.locator('#p1Headcount')).toHaveText('2');
    await expect(page.locator('#payrollFxRateBadge')).toHaveText('50.0000');

    // Test FX rate override on Screen 1
    await page.fill('#p1FxRateInput', '48.5000');
    await page.click('#btnP1ApplyFx');
    await expect(page.locator('#payrollFxRateBadge')).toHaveText('48.5000');
    await expect(page.locator('#payrollFxRateSourceBadge')).toHaveText('Manual Override');

    // Reset FX rate
    await page.click('#btnP1ResetFx');
    await expect(page.locator('#payrollFxRateBadge')).toHaveText('50.0000');

    // Advance to Screen 2
    await page.click('#btnP1Proceed');

    // 3. Screen 2 is active
    await expect(s1).toHaveClass(/payroll-hidden/);
    const s2 = page.locator('#payrollScreen2');
    await expect(s2).toBeVisible();
    await expect(stepper.locator('.payroll-step-pill.active')).toContainText('2. Approve');

    // Check Worksheet table on Screen 2
    const table = page.locator('#payrollWorksheetTable');
    await expect(table).toBeVisible();
    const rows = table.locator('#payrollTableBody tr');
    await expect(rows).toHaveCount(8);

    // Test adding a bonus via modal
    await page.click('#btnAddBonusModalBtn');
    const bonusModal = page.locator('#payrollBonusModal');
    await expect(bonusModal).toBeVisible();

    await page.fill('#bonusAmountInput', '450.00');
    await page.fill('#bonusDescriptionInput', 'Top performer award');
    await page.click('#bonusSaveBtn');
    await expect(bonusModal).not.toBeVisible();

    // Verify row displays bonus badge
    await expect(rows.first().locator('.p-bonus-pill')).toContainText('450');

    // Save Draft
    await page.click('#btnP2SaveDraft');
    await expect(page.locator('#payrollActionBanner')).toContainText('Payroll run saved as Draft');
  });

  test('TC-3: Lifecycle Transitions: Submit & Approve -> Screen 3 (Frozen Snapshots) -> Screen 4 (Preview)', async ({ page }) => {
    await page.click('#btnOpenCurrentCycle');
    // Proceed from Screen 1 to Screen 2
    await page.click('#btnP1Proceed');
    await expect(page.locator('#payrollScreen2')).toBeVisible();

    // Click Submit & Approve Run
    await page.click('#btnP2Approve');

    // Advances to Screen 3 (Processing)
    const s3 = page.locator('#payrollScreen3');
    await expect(s3).toBeVisible();
    await expect(page.locator('#payrollStepper .payroll-step-pill.active')).toContainText('3. Processing');

    // Finalized lock note is visible
    await expect(page.locator('#payrollLockNote')).toBeVisible();

    // Screen 3 table contains backend statutory snapshots
    const procTable = page.locator('#payrollProcessingTableBody tr');
    await expect(procTable).toHaveCount(3);
    // Verifies Insured Base and Employee SI columns
    await expect(procTable.first().locator('td').nth(4)).not.toBeEmpty();
    await expect(procTable.first().locator('td').nth(6)).not.toBeEmpty();

    // Advance to Screen 4 (Payment Preview)
    await page.click('#btnP3Next');
    const s4 = page.locator('#payrollScreen4');
    await expect(s4).toBeVisible();
    await expect(page.locator('#payrollStepper .payroll-step-pill.active')).toContainText('4. Payment Preview');

    // Check disbursement summary cards
    await expect(page.locator('#p4ExtBankTotal')).toBeVisible();
    await expect(page.locator('#p4IntCashTotal')).toBeVisible();
    await expect(page.locator('#p4TotalNet')).toBeVisible();
    await expect(page.locator('#payrollPaymentPreviewTableBody tr')).toHaveCount(8);
  });

  test('TC-4: Settings Page — Target funding accounts selection and payroll month schedule update', async ({ page }) => {
    await page.click('#payrollNavSettings');
    await expect(page.locator('#payrollViewSettings')).toBeVisible();

    const extSelect = page.locator('#payrollTargetExternalAccount');
    const intSelect = page.locator('#payrollTargetInternalAccount');
    await expect(extSelect).toBeVisible();
    await expect(intSelect).toBeVisible();

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

  test('TC-5: Screen 5 (Disbursement & GL Journal) and Screen 6 (Statutory Reconciliation)', async ({ page }) => {
    await page.click('#btnOpenCurrentCycle');
    // Screen 1 -> Screen 2
    await page.click('#btnP1Proceed');
    // Screen 2 -> Screen 3
    await page.click('#btnP2Approve');
    // Screen 3 -> Screen 4
    await page.click('#btnP3Next');
    // Screen 4 -> Screen 5
    await page.click('#btnP4Next');

    const s5 = page.locator('#payrollScreen5');
    await expect(s5).toBeVisible();
    await expect(page.locator('#payrollStepper .payroll-step-pill.active')).toContainText('5. Confirm Disbursal');

    // Confirm & Disburse
    await page.click('#btnP5ConfirmDisburse');
    await expect(page.locator('#payrollActionBanner')).toContainText('Payroll disbursement confirmed');

    // Results card & GL journal visible
    await expect(page.locator('#p5DisburseResultsCard')).toBeVisible();
    const journalCard = page.locator('#payrollJournalCard');
    await expect(journalCard).toBeVisible();
    await expect(journalCard.locator('#payrollJournalBadge')).toHaveText('Posted');

    // Toggle GL journal lines
    await page.click('#btnToggleJournal');
    await expect(page.locator('#payrollJournalDetails')).toBeVisible();

    // Advance to Screen 6 (Statutory Payments)
    await page.click('#btnP5ProceedStatutory');
    const s6 = page.locator('#payrollScreen6');
    await expect(s6).toBeVisible();
    await expect(page.locator('#payrollStepper .payroll-step-pill.active')).toContainText('6. Statutory Payments');

    // Check estimate snapshot displays
    await expect(page.locator('#p6SocialInsEstimate')).toContainText('EGP');
    await expect(page.locator('#p6TaxEstimate')).toContainText('EGP');

    // Record Social Insurance Obligation
    await page.fill('#p6SocialInsActual', '18500.00');
    await page.click('#btnP6RecordSocialIns');
    await expect(page.locator('#payrollActionBanner')).toContainText('Statutory obligation');

    // Verify linked obligation row appeared in table
    const statRows = page.locator('#payrollStatutoryRecordsTableBody tr');
    await expect(statRows).not.toHaveCount(0);

    // Finish returns to Runs List
    await page.click('#btnP6Finish');
    await expect(page.locator('#payrollViewList')).toBeVisible();
  });
});
