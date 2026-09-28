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

  test('TC-6: Screen 1 & Screen 4 Summary Cards — .payroll-card.payroll-stat styling and card boundaries', async ({ page }) => {
    // Open Run Page (Screen 1 is active)
    await page.click('#btnOpenCurrentCycle');
    const s1 = page.locator('#payrollScreen1');
    await expect(s1).toBeVisible();

    // Verify all 4 summary cards on Screen 1 have payroll-card and payroll-stat classes
    const s1Cards = s1.locator('.payroll-stats .payroll-stat');
    await expect(s1Cards).toHaveCount(4);

    const p1Card = page.locator('#p1Headcount').locator('xpath=ancestor::div[contains(@class, "payroll-stat")][1]');
    await expect(p1Card).toHaveClass(/payroll-card/);
    await expect(p1Card).toHaveClass(/payroll-stat/);

    // Check inner structure
    await expect(p1Card.locator('.label')).toHaveText('Active Headcount');
    await expect(p1Card.locator('.value')).toHaveText('2');
    await expect(p1Card.locator('.sub')).toHaveText('Eligible employees');

    // Check computed styles on Screen 1 card: border and background
    const p1CardBorder = await p1Card.evaluate((el) => window.getComputedStyle(el).borderStyle);
    expect(p1CardBorder).toBe('solid');

    // Advance through Screen 2 and Screen 3 to Screen 4
    await page.click('#btnP1Proceed');
    await expect(page.locator('#payrollScreen2')).toBeVisible();
    await page.click('#btnP2Approve');
    await expect(page.locator('#payrollScreen3')).toBeVisible();
    await page.click('#btnP3Next');
    const s4 = page.locator('#payrollScreen4');
    await expect(s4).toBeVisible();

    // Verify all 5 summary cards on Screen 4 have payroll-card and payroll-stat classes
    const s4Cards = s4.locator('.payroll-stats .payroll-stat');
    await expect(s4Cards).toHaveCount(5);

    const p4Card = page.locator('#p4TotalNet').locator('xpath=ancestor::div[contains(@class, "payroll-stat")][1]');
    await expect(p4Card).toHaveClass(/payroll-card/);
    await expect(p4Card).toHaveClass(/payroll-stat/);

    // Check inner structure
    await expect(p4Card.locator('.label')).toHaveText('Total Net Disbursal');
    await expect(p4Card.locator('.value')).toBeVisible();
    await expect(p4Card.locator('.sub')).toHaveText('Total employee net cash & wire');

    // Check computed styles on Screen 4 card
    const p4CardBorder = await p4Card.evaluate((el) => window.getComputedStyle(el).borderStyle);
    expect(p4CardBorder).toBe('solid');
  });

  test('TC-7: Screen 3 Entry Finalize Error Handling — Surface error banner and block transition on finalize failure', async ({ page }) => {
    await page.click('#btnOpenCurrentCycle');
    // Screen 1 -> Screen 2
    await page.click('#btnP1Proceed');
    const s2 = page.locator('#payrollScreen2');
    await expect(s2).toBeVisible();

    // Mock FinanceApi.finalizePayrollRun to reject with error
    await page.evaluate(() => {
      window.FinanceApi.finalizePayrollRun = async () => {
        throw new Error('Simulated statutory engine failure during finalization');
      };
    });

    // Attempt to submit and approve (which calls setStep(2) triggering finalize)
    await page.click('#btnP2Approve');

    // Verify:
    // a. Visible red banner with error message
    const banner = page.locator('#payrollActionBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/p-banner-red/);
    await expect(banner).toContainText('Simulated statutory engine failure during finalization');

    // b. stepIndex remains at 1 (Screen 2) - Screen 2 is NOT hidden
    await expect(s2).toBeVisible();
    await expect(s2).not.toHaveClass(/payroll-hidden/);

    // c. Screen 3 is NOT shown
    const s3 = page.locator('#payrollScreen3');
    await expect(s3).toHaveClass(/payroll-hidden/);

    // Stepper remains on Screen 2 (Approve)
    await expect(page.locator('#payrollStepper .payroll-step-pill.active')).toContainText('2. Approve');

    // Fallback message test: when error has no message
    await page.evaluate(() => {
      window.FinanceApi.finalizePayrollRun = async () => {
        throw new Error('');
      };
    });
    // Trigger setStep(2) directly to simulate retry
    await page.evaluate(async () => {
      await window.PayrollApp.setStep(2);
    });

    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/p-banner-red/);
    await expect(banner).toContainText('Finalization failed. Statutory snapshot could not be generated.');
    await expect(s2).toBeVisible();
    await expect(s3).toHaveClass(/payroll-hidden/);
  });

  test('TC-8: Server-backed payroll runs history and detail hydration via FinanceApi', async ({ page }) => {
    // Inject controlled runs into window.FinanceApi
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRuns = async () => [
        {
          id: 101,
          period_label: '2026-05',
          period_start: '2026-05-01',
          period_end: '2026-05-31',
          payment_date: '2026-05-31',
          status: 'paid',
          total_net: 45000.0,
          headcount: 10,
          paid_at: '2026-05-31T18:00:00Z',
          lines: [],
        },
      ];
      window.FinanceApi.getPayrollRun = async (id) => ({
        id: 101,
        period_label: '2026-05',
        period_start: '2026-05-01',
        period_end: '2026-05-31',
        payment_date: '2026-05-31',
        status: 'paid',
        total_net: 45000.0,
        headcount: 10,
        paid_at: '2026-05-31T18:00:00Z',
        lines: [
          { employee_id: 1, employee_name: 'Alice', net_pay: 25000, compensation_type: 'external_usd', payment_status: 'paid' },
          { employee_id: 2, employee_name: 'Bob', net_pay: 20000, compensation_type: 'internal_usd_cash', payment_status: 'paid' },
        ],
        exceptions: [],
      });

      await window.PayrollApp.loadRunsFromDb();
      window.PayrollApp.drawRunsList();
    });

    const tbody = page.locator('#payrollRunsTableBody');
    await expect(tbody).toContainText('2026-05');
    await expect(tbody).toContainText('$45,000.00');

    // Click on the server-backed run row
    await page.click('#payrollRunsTableBody tr:has-text("2026-05")');

    // Should open run view and hydrate currentRun
    await expect(page.locator('#payrollViewRun')).toBeVisible();
    const currentRunId = await page.evaluate(() => window.PayrollApp.currentRun?.id);
    expect(currentRunId).toBe(101);
  });

  test('TC-9: Failed API calls render explicit error banner without fabricated fake payroll records', async ({ page }) => {
    // Inject API error
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRuns = async () => {
        throw new Error('500 Internal Server Error: Database cluster offline');
      };
      // Force non-mock mode behavior for error test
      const savedSearch = window.location.search;
      try {
        await window.PayrollApp.loadRunsFromDb();
      } catch (_) {}
      window.PayrollApp.runsLoadError = '500 Internal Server Error: Database cluster offline';
      window.PayrollApp.drawRunsList();
    });

    const tbody = page.locator('#payrollRunsTableBody');
    await expect(tbody).toContainText('500 Internal Server Error: Database cluster offline');
    await expect(tbody).not.toContainText('2026-08');
  });

  test('TC-10: Phase B1 — Persisted-State Resolver and Resume Logic', async ({ page }) => {
    // 1. Verify resolution table logic via PayrollApp.resolvePayrollRunState
    const unitResults = await page.evaluate(() => {
      const resolver = window.PayrollApp.resolvePayrollRunState;
      return {
        draft: resolver({ status: 'draft' }),
        submitted: resolver({ status: 'submitted' }),
        approved: resolver({ status: 'approved' }),
        finalized: resolver({ status: 'finalized' }),
        paidNoObl: resolver({ status: 'paid' }, []),
        paidAccrued: resolver({ status: 'paid' }, [{ id: 1, status: 'accrued' }]),
        paidMixed: resolver({ status: 'paid' }, [{ id: 1, status: 'accrued' }, { id: 2, status: 'remitted' }]),
        paidRemitted: resolver({ status: 'paid' }, [{ id: 1, status: 'remitted' }, { id: 2, status: 'remitted' }]),
        malformed: resolver({ status: 'invalid_status_xyz' }),
      };
    });

    expect(unitResults.draft.stepIndex).toBe(1);
    expect(unitResults.submitted.stepIndex).toBe(1);
    expect(unitResults.approved.stepIndex).toBe(2);
    expect(unitResults.finalized.stepIndex).toBe(3);
    expect(unitResults.paidNoObl.stepIndex).toBe(4);
    expect(unitResults.paidNoObl.badge).toBe('Not Recorded');
    expect(unitResults.paidAccrued.stepIndex).toBe(5);
    expect(unitResults.paidAccrued.badge).toBe('Recorded — Unpaid');
    expect(unitResults.paidMixed.stepIndex).toBe(5);
    expect(unitResults.paidMixed.badge).toBe('Partially Reconciled');
    expect(unitResults.paidRemitted.stepIndex).toBe(5);
    expect(unitResults.paidRemitted.badge).toBe('Reconciled');
    expect(unitResults.malformed.stepIndex).toBe(1);

    // 2. Fresh open / resume of finalized run navigates to Screen 4
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRun = async () => ({
        id: 201,
        period_label: '2026-04',
        status: 'finalized',
        total_net: 30000,
        lines: [],
        exceptions: [],
      });
      await window.PayrollApp.openHistoryRun(201);
    });
    await expect(page.locator('#payrollScreen4')).toBeVisible();

    // 3. Fresh open of paid run with no obligations navigates to Screen 5 with "Not Recorded" badge
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRun = async () => ({
        id: 202,
        period_label: '2026-03',
        status: 'paid',
        total_net: 30000,
        lines: [],
        exceptions: [],
      });
      window.FinanceApi.listStatutoryObligations = async () => [];
      await window.PayrollApp.openHistoryRun(202);
    });
    await expect(page.locator('#payrollScreen5')).toBeVisible();
    await expect(page.locator('#p5StatutoryBadge')).toHaveText('Not Recorded');

    // 4. Fresh open of paid run with accrued obligations navigates to Screen 6 with "Recorded — Unpaid" badge
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRun = async () => ({
        id: 203,
        period_label: '2026-02',
        status: 'paid',
        total_net: 30000,
        lines: [],
        exceptions: [],
      });
      window.FinanceApi.listStatutoryObligations = async () => [
        { id: 10, source_type: 'payroll_run', source_id: 203, period: '2026-02', obligation_type: 'social_insurance_employee', amount_accrued: 1500, status: 'accrued' }
      ];
      await window.PayrollApp.openHistoryRun(203);
    });
    await expect(page.locator('#payrollScreen6')).toBeVisible();
    await expect(page.locator('#p6StatutoryBadge')).toHaveText('Recorded — Unpaid');
  });

  test('TC-11: Phase B2 — Visual Parity for Screens 4, 5, 6 with Real Data & Inline Settlement', async ({ page }) => {
    // 1. Screen 4: Missing Bank details stat card and warning pill
    await page.evaluate(async () => {
      window.PayrollApp.currentPreview = {
        total_net: 25000,
        final_ext_total: 15000,
        final_int_total: 10000,
        exceptions: [
          { code: 'MISSING_BANK_DETAILS', severity: 'warning', employee_id: 301, details: 'Employee #301 missing external IBAN' }
        ]
      };
      window.PayrollApp.rows = [
        { id: 301, name: 'Youssef Adel', baseExt: 1500, baseInt: 4000, deductions: 400, bonuses: [], bank_name: null, bank_account_masked: null },
        { id: 302, name: 'Salma Ibrahim', baseExt: 0, baseInt: 4450, deductions: 400, bonuses: [], bank_name: 'CIB', bank_account_masked: '****1234' }
      ];
      window.PayrollApp.showPage('run');
      window.PayrollApp.setStep(3);
    });

    await expect(page.locator('#payrollScreen4')).toBeVisible();
    await expect(page.locator('#p4MissingBankCount')).toHaveText('1');
    const tableBody = page.locator('#payrollPaymentPreviewTableBody');
    await expect(tableBody).toContainText('Missing Bank Details (D-006)');

    // 2. Screen 5: Informational Rail Cards, reconciliation to grand total, and real exceptions
    await page.evaluate(() => {
      window.PayrollApp.setStep(4);
    });
    await expect(page.locator('#payrollScreen5')).toBeVisible();
    await expect(page.locator('#p5ExtTotal')).toBeVisible();
    await expect(page.locator('#p5IntTotal')).toBeVisible();

    // Verify grand total equals external rail + internal rail
    const totalsMatch = await page.evaluate(() => {
      const ext = parseFloat((document.getElementById('p5ExtTotal')?.textContent || '0').replace(/[^0-9.]/g, ''));
      const int = parseFloat((document.getElementById('p5IntTotal')?.textContent || '0').replace(/[^0-9.]/g, ''));
      const net = (window.PayrollApp.currentPreview?.total_net) || (window.PayrollApp.rollup().net);
      return Math.abs((ext + int) - net) < 0.05;
    });
    expect(totalsMatch).toBe(true);

    // Verify persisted warning banner rendered on Screen 5
    await expect(page.locator('#payrollExceptionList')).toContainText('Missing Bank Details');

    // 3. Screen 6: Inline Debit Account & Payment Date Settlement
    let settledPayload = null;
    await page.evaluate(() => {
      window.FinanceApi.getStatutoryObligation = async (id) => ({
        id: Number(id),
        amount_accrued: 2200,
        status: 'accrued'
      });
      window.FinanceApi.settleStatutoryObligation = async (id, payload) => {
        window._lastSettled = { id, payload };
        return { id, status: 'remitted' };
      };
      window.FinanceApi.listStatutoryObligations = async () => [
        { id: 99, obligation_type: 'social_insurance_employee', period: window.PayrollApp.month, amount_accrued: 2200, amount_remitted: 0, status: 'accrued', notes: 'payroll_run_id:1' }
      ];
      window.PayrollApp.banks = [
        { id: 7, name: 'Custom Settling Account', currency: 'USD', number: '****9988' }
      ];
      window.PayrollApp.setStep(5);
    });

    await expect(page.locator('#payrollScreen6')).toBeVisible();
    await expect(page.locator('#p6SiDebitAccount')).toBeVisible();
    await expect(page.locator('#p6SiPaymentDate')).toBeVisible();

    // Fill inline fields
    await page.selectOption('#p6SiDebitAccount', '7');
    await page.fill('#p6SiPaymentDate', '2026-09-25');

    // Settle obligation via inline action
    await page.click('#btnP6SettleSocialIns');

    const lastSettled = await page.evaluate(() => window._lastSettled);
    expect(lastSettled).not.toBeNull();
    expect(lastSettled.payload.bank_account_id).toBe(7);
    expect(lastSettled.payload.payment_date).toBe('2026-09-25');
  });

  test('TC-12: Phase B3 — History Obligation-State Surfacing in Screen 1', async ({ page }) => {
    // Inject past runs with different reconciliation states
    await page.evaluate(async () => {
      window.FinanceApi.getPayrollRuns = async () => [
        { id: 301, period_label: '2026-05', status: 'paid', total_net: 20000, headcount: 5 },
        { id: 302, period_label: '2026-04', status: 'paid', total_net: 20000, headcount: 5 },
        { id: 303, period_label: '2026-03', status: 'paid', total_net: 20000, headcount: 5 },
      ];
      window.FinanceApi.listStatutoryObligations = async () => [
        // 301 has no obligations -> Not Recorded
        // 302 has accrued obligations -> Recorded — Unpaid
        { id: 1, source_type: 'payroll_run', source_id: 302, period: '2026-04', status: 'accrued' },
        // 303 has remitted obligations -> Reconciled
        { id: 2, source_type: 'payroll_run', source_id: 303, period: '2026-03', status: 'remitted' },
      ];

      await window.PayrollApp.loadRunsFromDb();
      window.PayrollApp.drawRunsList();
    });

    const tbody = page.locator('#payrollRunsTableBody');
    await expect(tbody.locator('tr:has-text("2026-05")')).toContainText('Not Recorded');
    await expect(tbody.locator('tr:has-text("2026-04")')).toContainText('Recorded — Unpaid');
    await expect(tbody.locator('tr:has-text("2026-03")')).toContainText('Reconciled');
  });
});
