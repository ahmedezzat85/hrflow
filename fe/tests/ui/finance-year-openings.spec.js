import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// BI-1c (D-043): yearly opening balances modal, month view and warnings in the yearly summary, cash flow adjustments (mock mode).
const THIS_YEAR = new Date().getFullYear();

test.describe('BI-1c: yearly opening balances', () => {
  let consoleErrors;
  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });
  test.afterEach(() => {
    expect(consoleErrors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
  });

  async function openModalFor(page, accountName) {
    await openAdminPage(page, 'a-finance-accounts');
    const row = page.locator(`#financeAccountsTableBody tr:has-text("${accountName}")`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.locator('.btn-account-year-openings').click();
    await expect(page.locator('#accountYearOpeningsModal')).toBeVisible();
    await expect(page.locator('#accountYearOpeningsBody tr').first()).toBeVisible();
  }

  test('lists every year, highlights a difference and labels carried-forward years', async ({ page }) => {
    await openModalFor(page, 'Voyance Operating USD');
    const thisYear = page.locator(`#accountYearOpeningsBody tr[data-year="${THIS_YEAR}"]`);
    await expect(thisYear).toHaveAttribute('data-entered', 'true');
    await expect(thisYear.locator('[data-year-opening-diff]')).toContainText('33,600');
    await expect(thisYear).toContainText("Differs from the previous year's closing by");
    await expect(thisYear).toContainText('Add a note to explain it (optional)');
    await expect(thisYear).toContainText('From the January bank statement');
    // years before the entered one come from the account opening; no row means "Set opening"
    const earlier = page.locator(`#accountYearOpeningsBody tr[data-year="${THIS_YEAR - 1}"]`);
    await expect(earlier).toHaveAttribute('data-entered', 'false');
    await expect(earlier.locator('.btn-year-opening-set')).toBeVisible();
    await page.click('#accountYearOpeningsModal button:has-text("Close")');
    await expect(page.locator('#accountYearOpeningsModal')).not.toBeVisible();
  });

  test('set, edit (negative) and remove an opening; the note is optional', async ({ page }) => {
    await openModalFor(page, 'Voyance Operating USD');
    const y = THIS_YEAR - 1;
    const row = () => page.locator(`#accountYearOpeningsBody tr[data-year="${y}"]`);
    await row().locator('.btn-year-opening-set').click();
    await page.fill('#fYearOpeningBalance', '150000');
    await page.click('#accountYearOpeningSaveBtn');
    await expect(row()).toHaveAttribute('data-entered', 'true');
    await expect(row().locator('[data-year-opening-diff]')).toBeVisible();

    await row().locator('.btn-year-opening-edit').click();
    await page.fill('#fYearOpeningBalance', '-500');
    await page.fill('#fYearOpeningNote', 'Overdrawn at year start');
    await page.click('#accountYearOpeningSaveBtn');
    await expect(row()).toContainText('Overdrawn at year start');
    await expect(row().locator('td').nth(1)).toContainText('-500');

    await row().locator('.btn-year-opening-remove').click();
    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(row()).toHaveAttribute('data-entered', 'false');
  });

  test('without finance.account.write the table is read-only', async ({ page }) => {
    await page.evaluate(() => {
      const original = SessionInfo.hasPermission;
      SessionInfo.hasPermission = (k) => k !== 'finance.account.write' && original.call(SessionInfo, k);
    });
    await openModalFor(page, 'Voyance Operating USD');
    await expect(page.locator('#accountYearOpeningsBody .btn-year-opening-edit, #accountYearOpeningsBody .btn-year-opening-set, #accountYearOpeningsBody .btn-year-opening-remove')).toHaveCount(0);
  });

  test('the account form explains the legacy opening balance', async ({ page }) => {
    await openAdminPage(page, 'a-finance-accounts');
    await page.evaluate(() => window.openAddCompanyBankAccountModal());
    await expect(page.locator('#fCompanyOpeningHintText')).toContainText('Yearly opening balances');
  });
});

test.describe('BI-1c: yearly summary month view and cash flow', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin');
    await page.waitForLoadState('networkidle');
    await openAdminPage(page, 'a-finance-reports');
  });

  test('month selector, source badges and the warnings banner with a link to the modal', async ({ page }) => {
    await page.evaluate(() => window.openReportFromLibrary('fiscal-year-summary'));
    const pane = page.locator('#reportPaneFiscalYear');
    await expect(pane).toBeVisible();
    const monthSel = pane.locator('#reportFiscalYearMonth');
    await expect(monthSel.locator('option')).toHaveCount(13);
    await expect(monthSel.locator('option').first()).toHaveText('Whole year');

    await expect(pane.locator('#reportFiscalYear')).toHaveValue(String(THIS_YEAR));
    const operating = pane.locator('#reportFiscalYearTableBody tr:has-text("Voyance Operating USD")');
    await expect(operating.locator('.fy-source-badge[data-source="entered"]')).toHaveText('Entered');
    const warnings = pane.locator('#reportFiscalYearWarnings');
    await expect(warnings).toBeVisible();
    await expect(warnings.locator('[data-warning-type="opening_variance"]')).toContainText('differs from the previous year');
    // other accounts have no entered row this year: no badge, no variance warning
    await expect(pane.locator('#reportFiscalYearTableBody tr:has-text("CIB EGP Operating") .fy-source-badge')).toHaveCount(0);

    await warnings.locator('.fy-warning-link').first().click();
    await expect(page.locator('#accountYearOpeningsModal')).toBeVisible();
    await page.click('#accountYearOpeningsModal button:has-text("Close")');

    // a month: headings show the period and later months open on the previous month's closing
    await monthSel.selectOption('3');
    await expect(pane.locator('#reportFiscalYearNote')).toContainText(`March ${THIS_YEAR} (${THIS_YEAR}-03-01 to ${THIS_YEAR}-03-31)`);
    await expect(pane.locator('#reportFiscalYearWarnings')).toBeHidden();
    await expect(operating.locator('.fy-source-badge')).toHaveCount(0);
    const cells = await operating.locator('td.cell-money').allTextContents();
    expect(cells.length).toBe(4);

    await monthSel.selectOption('');
    await expect(pane.locator('#reportFiscalYearWarnings')).toBeVisible();
  });

  test('cash flow shows the adjustments line and a warning when it does not reconcile', async ({ page }) => {
    await page.evaluate(() => window.openReportFromLibrary('cash-flow'));
    await page.evaluate((y) => {
      document.getElementById('reportShellDateFrom').value = `${y - 1}-12-01`;
      document.getElementById('reportShellDateTo').value = `${y}-03-31`;
      return window.loadReportCashFlow();
    }, THIS_YEAR);
    await expect(page.locator('#reportCfAdjustmentRow')).toBeVisible();
    await expect(page.locator('#reportCfAdjustmentRow')).toContainText('Fiscal-year opening adjustments');
    await expect(page.locator('#reportCfNotReconciled')).toBeHidden();

    // a statement that does not reconcile shows the unexplained difference
    await page.evaluate(() => {
      const original = FinanceApi.getCashFlowReport;
      FinanceApi.getCashFlowReport = async (p) => ({ ...(await original.call(FinanceApi, p)), is_reconciled: false, unexplained_difference: 40 });
      return window.loadReportCashFlow();
    });
    await expect(page.locator('#reportCfNotReconciled')).toBeVisible();
    await expect(page.locator('#reportCfNotReconciled')).toContainText('does not reconcile');
    await expect(page.locator('#reportCfNotReconciled')).toContainText('40');
  });
});
