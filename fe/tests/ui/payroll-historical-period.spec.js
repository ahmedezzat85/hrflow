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

  test('changing the month on step 1 reloads the preview and staffs the run from it', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => { PayrollApp.currentRun = null; PayrollApp.setStep(0); });
    await expect(page.locator('#p1Month')).toBeVisible();
    // Employee list as the server preview returns it for a past month: one active and one leaver, plus a skipped one
    await page.evaluate(() => {
      PayrollApp._allEmployees = [
        { id: 1, name: 'Sarah Connor', status: 'Active', external_salary_usd: 10000 },
        { id: 2, name: 'Lee Leaver', status: 'Inactive', external_salary_usd: 3000 },
        { id: 7, name: 'Omar Planless', status: 'Active', external_salary_usd: 1000 },
      ];
      const real = FinanceApi.previewPayrollRun;
      FinanceApi.previewPayrollRun = async (p) => {
        const prev = await real.call(FinanceApi, p);
        if (prev.historical_period) {
          prev.recipients = [{ employee_id: 1 }, { employee_id: 2 }];
          // the plan in force that month differs from today's record (10000 / 3000)
          prev.lines = [
            { employee_id: 1, compensation_type: 'external_usd', base_salary: 8000 },
            { employee_id: 1, compensation_type: 'internal_usd', base_salary: 2000 },
            { employee_id: 2, compensation_type: 'external_usd', base_salary: 2500 },
          ];
        }
        return prev;
      };
    });
    await page.fill('#p1Month', '2025-03');
    await page.dispatchEvent('#p1Month', 'change');
    await expect.poll(() => page.evaluate(() => PayrollApp.rows.map(r => r.name).join(','))).toBe('Sarah Connor,Lee Leaver');
    expect(await page.evaluate(() => PayrollApp.rows.map(r => [r.baseExt, r.baseInt]))).toEqual([[8000, 2000], [2500, 0]]);
    // Back to the current month: the roster is the active employees again
    const ym = new Date().toISOString().slice(0, 7);
    await page.fill('#p1Month', ym);
    await page.dispatchEvent('#p1Month', 'change');
    await expect.poll(() => page.evaluate(() => PayrollApp.rows.map(r => r.name).join(','))).toBe('Sarah Connor,Omar Planless');
  });

  test('reopening a saved historical run shows the people and pay saved on it', async ({ page }) => {
    await openRun(page);
    await page.evaluate(async () => {
      PayrollApp._allEmployees = [
        { id: 1, name: 'Sarah Connor', status: 'Active', external_salary_usd: 10000 },
        { id: 2, name: 'Lee Leaver', status: 'Inactive', external_salary_usd: 3000 },
        { id: 3, name: 'Nora Newer', status: 'Active', external_salary_usd: 500 },
      ];
      FinanceApi.getPayrollRun = async () => ({
        id: 55, status: 'draft', period_label: '2025-03', period_start: '2025-03-01', period_end: '2025-03-31',
        payment_date: '2025-03-31', historical_period: true, skipped_employees: [], exceptions: [],
        lines: [
          { employee_id: 1, compensation_type: 'external_usd', base_salary: 8000, deductions_total: 0 },
          { employee_id: 1, compensation_type: 'internal_usd', base_salary: 2000, deductions_total: 220 },
          { employee_id: 2, compensation_type: 'external_usd', base_salary: 2500, deductions_total: 0 },
        ],
      });
      await PayrollApp.openHistoryRun(55);
    });
    const rows = await page.evaluate(() => PayrollApp.rows.map(r => [r.name, r.baseExt, r.baseInt, r.deductions]));
    expect(rows).toEqual([['Sarah Connor', 8000, 2000, 220], ['Lee Leaver', 2500, 0, 0]]);
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
