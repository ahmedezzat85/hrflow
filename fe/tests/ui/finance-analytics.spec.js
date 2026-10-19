import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('X6: Revenue and subscription analytics (D-029, D-030, D-031)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-reports');
    await expect(page.locator('#reportLibraryGrid .report-catalog-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('the library lists the three analytics reports', async ({ page }) => {
    for (const title of ['Revenue by Product, Book and Source', 'Subscription Spend', 'Subscription Proofs Missing']) {
      await expect(page.locator('#reportLibraryGrid')).toContainText(title);
    }
  });

  test('revenue report groups per currency, shows untagged revenue and reverses a receipt', async ({ page }) => {
    await page.evaluate(() => { FinanceBookView.set('reports', 'consolidated'); });
    await page.evaluate(() => openReportFromLibrary('revenue-breakdown'));
    await expect(page.locator('#reportPaneRevenueBreakdown')).toBeVisible();
    await page.selectOption('#reportShellCurrency', 'USD').catch(() => {});
    const rows = page.locator('#reportRevenueTableBody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reportRevenueTableBody')).toContainText('HRFlow Cloud (SaaS)');

    await page.selectOption('#reportRevenueGroupBy', 'source');
    await expect(page.locator('#reportRevenueGroupHead')).toHaveText('Source');
    await expect(page.locator('#reportRevenueTableBody')).toContainText('Stripe payout');
    await page.selectOption('#reportRevenueGroupBy', 'book_code');
    await expect(page.locator('#reportRevenueTableBody')).toContainText('Overseas');

    // Reverse the first Stripe receipt: the receipt list gains a reversal row
    const before = await page.locator('#reportRevenueReceiptsBody tr').count();
    await page.locator('#reportRevenueReceiptsBody tr:has-text("Stripe payout") .btn-receipt-reverse').first().click();
    await page.fill('#financeConfirmReason', 'Booked twice');
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#reportRevenueReceiptsBody tr')).toHaveCount(before + 1);
    await expect(page.locator('#reportRevenueReceiptsBody')).toContainText('Reversal');
  });

  test('Overseas book view narrows the revenue report', async ({ page }) => {
    await page.evaluate(() => { FinanceBookView.set('reports', 'local'); });
    await page.evaluate(() => openReportFromLibrary('revenue-breakdown'));
    await expect(page.locator('#reportPaneRevenueBreakdown')).toBeVisible();
    await page.selectOption('#reportRevenueGroupBy', 'book_code');
    await expect(page.locator('#reportRevenueTableBody')).not.toContainText('Overseas');
    await page.locator('#financeBookSwitcherReports [data-book="overseas"]').click();
    await expect(page.locator('#reportRevenueTableBody')).toContainText('Overseas');
  });

  test('subscription spend and proofs missing reports render', async ({ page }) => {
    await page.evaluate(() => { FinanceBookView.set('reports', 'consolidated'); });
    await page.evaluate(() => openReportFromLibrary('subscription-spend'));
    await expect(page.locator('#reportPaneSubscriptionSpend')).toBeVisible();
    await expect(page.locator('#reportSubSpendBody tr').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reportSubSpendRollups')).toContainText('By vendor');
    await expect(page.locator('#reportSubSpendRollups')).toContainText('By book');

    await page.evaluate(() => openReportFromLibrary('subscription-proofs-missing'));
    await expect(page.locator('#reportPaneSubscriptionProofsMissing')).toBeVisible();
    await expect(page.locator('#reportProofsMissingBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('exports go through the audited export call with the book in the filters', async ({ page }) => {
    await page.evaluate(() => { FinanceBookView.set('reports', 'overseas'); });
    await page.evaluate(() => openReportFromLibrary('revenue-breakdown'));
    await expect(page.locator('#reportPaneRevenueBreakdown')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => exportActiveReport('excel')),
    ]);
    expect(download.suggestedFilename()).toContain('revenue-breakdown');
    const audit = await page.evaluate(() => FinanceMockState.reportExportAudits[0]);
    expect(audit.report_key).toBe('revenue-breakdown');
    expect(audit.filters.book).toBe('overseas');
  });
});
