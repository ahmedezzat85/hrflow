import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// HP-1: a historical run shows a badge and the employees left off it, with the reason (mock mode).
async function openRun(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function' && window.AdminNav);
  await openAdminPage(page, 'a-finance-payroll-runs');
  await page.evaluate(() => { PayrollApp.showPage('run'); PayrollApp.setStep(1); });
  await expect(page.locator('#payrollScreen2')).toBeVisible();
}

async function showPeriod(page, label, end) {
  await page.evaluate(async ({ label, end }) => {
    PayrollApp.currentRun = null;
    PayrollApp.currentPreview = await FinanceApi.previewPayrollRun({ period_label: label, period_start: `${label}-01`, period_end: end });
    PayrollApp.drawScreen2();
  }, { label, end });
}

test.describe('HP-1: historical payroll period', () => {
  test('a past period shows the badge and a collapsible skipped list with reasons', async ({ page }) => {
    await openRun(page);
    await showPeriod(page, '2025-03', '2025-03-31');
    await expect(page.locator('#p2HistoricalBadge')).toBeVisible();
    await expect(page.locator('#p2HistoricalBadge')).toContainText('Historical period');
    const details = page.locator('#p2SkippedDetails');
    await expect(details.locator('summary')).toHaveText('Skipped employees (2)');
    await expect(page.locator('#p2SkippedList')).toBeHidden(); // collapsed until opened
    await details.locator('summary').click();
    const items = page.locator('#p2SkippedList li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Omar Planless');
    await expect(items.nth(0)).toContainText('No compensation plan in this period');
    await expect(items.nth(1)).toContainText('Maya Newhire');
    await expect(items.nth(1)).toContainText('Joined after this period');
  });

  test('a saved run keeps showing the list, and a later month shows neither', async ({ page }) => {
    await openRun(page);
    await page.evaluate(async () => {
      await showPeriodRun();
      async function showPeriodRun() {
        const prev = await FinanceApi.previewPayrollRun({ period_label: '2025-04', period_start: '2025-04-01', period_end: '2025-04-30' });
        PayrollApp.currentRun = { id: 99, status: 'draft', historical_period: true, skipped_employees: prev.skipped_employees, exceptions: [] };
        PayrollApp.currentPreview = prev;
        PayrollApp.drawScreen2();
      }
    });
    await expect(page.locator('#p2HistoricalBadge')).toBeVisible();
    await expect(page.locator('#p2SkippedDetails summary')).toHaveText('Skipped employees (2)');

    await showPeriod(page, '2099-01', '2099-01-31');
    await expect(page.locator('#p2HistoricalPanel')).toBeHidden();
    await expect(page.locator('#p2HistoricalBadge')).toHaveCount(0);
  });
});
