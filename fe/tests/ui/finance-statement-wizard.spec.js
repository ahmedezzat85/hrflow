import { test, expect } from '@playwright/test';

test.describe('Story 6.1: Statement Import Wizard', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Accounts workspace
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Switch to Statements subtab
    await page.click('#subtabFinanceStatements');
    await expect(page.locator('#financeSubPaneStatements')).toBeVisible();

    // Open Statement Import Wizard
    await page.click('#btnUploadStatement');
    await expect(page.locator('#financeStatementUploadModal')).toBeVisible();
  });

  test('AC 1: Accessible single period control and configuration capture', async ({ page }) => {
    const modal = page.locator('#financeStatementUploadModal');

    // Verify wizard title and step indicator
    await expect(modal.locator('#stmtUploadModalTitleText')).toHaveText('Statement Import Wizard');
    await expect(modal.locator('#stmtStepIndicator1')).toHaveClass(/active/);

    // Verify accessible single period month control exists (no duplicate dropdowns)
    const periodInput = modal.locator('#stmtUploadPeriodMonth');
    await expect(periodInput).toBeVisible();
    await expect(periodInput).toHaveAttribute('type', 'month');

    // Verify Opening and Closing balance inputs
    await expect(modal.locator('#stmtOpeningBalance')).toBeVisible();
    await expect(modal.locator('#stmtClosingBalance')).toBeVisible();

    // Verify format, encoding, and decimal separator options
    await expect(modal.locator('#stmtEncoding')).toBeVisible();
    await expect(modal.locator('#stmtDateFormat')).toBeVisible();
    await expect(modal.locator('#stmtDecimalSeparator')).toBeVisible();

    // Close wizard
    await modal.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('AC 2: Preview step extracts rows without committing and displays mapping & preview', async ({ page }) => {
    const modal = page.locator('#financeStatementUploadModal');

    // Fill Step 1
    await modal.locator('#stmtUploadAccountId').selectOption({ index: 1 });
    await modal.locator('#stmtUploadPeriodMonth').fill('2026-09');
    await modal.locator('#stmtOpeningBalance').fill('5000.00');
    await modal.locator('#stmtClosingBalance').fill('6700.00');

    // Create and attach a mock CSV file
    const csvContent = "Date,Description,Debit,Credit,Reference\n2026-09-02,AWS Hosting,500.00,,REF-001\n2026-09-08,Client Inflow,,2200.00,REF-002\n";
    await modal.locator('#stmtUploadFile').setInputFiles({
      name: 'chase_sept_2026.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    // Advance to Step 2 (Upload & Preview)
    await modal.locator('#btnStmtWizardStep1Next').click();

    // Step 2 should now be visible and indicator active
    await expect(modal.locator('#stmtWizardStep2')).toBeVisible();
    await expect(modal.locator('#stmtStepIndicator2')).toHaveClass(/active/);

    // Verify file metadata banner
    await expect(modal.locator('#stmtMetaFileName')).toContainText('chase_sept_2026.csv');
    await expect(modal.locator('#stmtMetaFingerprintBadge')).toBeVisible();

    // Verify column mapping dropdowns populated
    await expect(modal.locator('#wizardMapDateCol')).toBeVisible();
    await expect(modal.locator('#wizardMapDescCol')).toBeVisible();

    // Verify live preview rows rendered in table
    const previewTbody = modal.locator('#stmtWizardPreviewTbody');
    await expect(previewTbody).toBeVisible();
    await expect(previewTbody.locator('tr')).toHaveCount(2);
    await expect(previewTbody).toContainText('AWS CLOUD INFRASTRUCTURE INVOICE');
    await expect(previewTbody).toContainText('Inflow');

    // Advance to Step 3 (Validate)
    await modal.locator('#stmtWizardStep2 button:has-text("Next: Validate")').click();
    await expect(modal.locator('#stmtWizardStep3')).toBeVisible();
    await expect(modal.locator('#stmtStepIndicator3')).toHaveClass(/active/);

    // Verify KPI summary cards
    await expect(modal.locator('#stmtKpiValid')).toHaveText('2');
    await expect(modal.locator('#stmtKpiErrors')).toHaveText('0');

    // Verify Statement Balance Delta Check displays Balanced
    await expect(modal.locator('#stmtBalanceStatusBadge')).toHaveText('Balanced');
    await expect(modal.locator('#stmtMathOpening')).toContainText('$5000.00');
    await expect(modal.locator('#stmtMathNet')).toContainText('$1700.00');
    await expect(modal.locator('#stmtMathCalcClosing')).toContainText('$6700.00');
    await expect(modal.locator('#stmtMathStatedClosing')).toContainText('$6700.00');

    // Advance to Step 4 (Confirm & Import)
    await modal.locator('#btnStmtWizardStep3Next').click();
    await expect(modal.locator('#stmtWizardStep4')).toBeVisible();
    await expect(modal.locator('#stmtStepIndicator4')).toHaveClass(/active/);

    // Commit statement import
    await modal.locator('#btnConfirmCommitStatement').click();

    // Wizard closes and success notification displays
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast').last()).toContainText('Statement imported successfully');
  });

  test('AC 3: Interrupted import can be safely discarded', async ({ page }) => {
    const modal = page.locator('#financeStatementUploadModal');

    // Fill Step 1
    await modal.locator('#stmtUploadAccountId').selectOption({ index: 1 });
    await modal.locator('#stmtUploadPeriodMonth').fill('2026-09');

    const csvContent = "Date,Description,Debit,Credit\n2026-09-02,Temporary Line,100.00,\n";
    await modal.locator('#stmtUploadFile').setInputFiles({
      name: 'temp_discard.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    // Preview
    await modal.locator('#btnStmtWizardStep1Next').click();
    await expect(modal.locator('#stmtWizardStep2')).toBeVisible();

    // Proceed to Step 3
    await modal.locator('#stmtWizardStep2 button:has-text("Next: Validate")').click();
    await expect(modal.locator('#stmtWizardStep3')).toBeVisible();

    // Click Discard
    await modal.locator('#stmtWizardStep3 button:has-text("Discard")').click();

    // Modal closes safely without committing
    await expect(modal).not.toBeVisible();
  });
});
