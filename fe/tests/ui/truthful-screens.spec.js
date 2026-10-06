import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof showSection === 'function' && window.AdminNav && window.PayrollApp);
}

const money = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));

test.describe('U3 truthful screens', () => {
  test('employee portal shows no invented figures or plan names', async ({ page }) => {
    await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#empSidebar')).toBeAttached({ timeout: 15000 });
    const text = await page.evaluate(() => document.querySelector('#employee-app').textContent);
    for (const invented of ['Mar 2027', 'Estimated +8%', '7 of 12 months', '63,000', 'Premium Family Care', 'Allianz']) {
      expect(text, invented).not.toContain(invented);
    }
    await expect(page.locator('#empNotificationBtn')).toHaveCount(0);
  });

  test('admin insurance and finance overview carry no placeholder numbers or dev panels', async ({ page }) => {
    await openAdmin(page);
    const text = await page.evaluate(() => document.querySelector('#admin-app').textContent);
    for (const bad of ['Visualizations in development', 'market rate lookup', 'Funds released', 'D-006', 'MISSING_BANK_DETAILS', 'Clears domestic', 'Disburse Payroll']) {
      expect(text, bad).not.toContain(bad);
    }
    expect(text).not.toMatch(/\bRAIL\b/);
    await expect(page.locator('#adminNotificationBtn')).toHaveCount(0);
    await expect(page.locator('#financeDashboardSummaryEmpty')).toHaveCount(0);
  });

  test('one money formatter: EGP shows as "EGP 34,877.00", never a pound sign', async ({ page }) => {
    await openAdmin(page);
    const out = await page.evaluate(() => ({
      core: FinanceFormat.formatMoney(34877, 'EGP'),
      hr: fmtMoney(34877),
      hrFrac: fmtMoney(34877.5),
      usd: fmtUSD(12500),
      gbp: FinanceFormat.formatMoney(5, 'GBP'),
      global: window.formatCurrency(1250.5, 'EGP'),
    }));
    expect(out.core).toBe('EGP 34,877.00');
    expect(out.hr).toBe('EGP 34,877');
    expect(out.hrFrac).toBe('EGP 34,877.5');
    expect(out.usd).toBe('$12,500');
    expect(out.gbp).toBe('GBP 5.00');
    expect(out.global).toBe('EGP 1,250.50');
    const bodyText = await page.evaluate(() => document.body.textContent + document.body.innerHTML);
    expect(bodyText).not.toContain('£');
  });

  test('Salary and Raises total monthly payroll is shown in USD', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-salary', 'admin'));
    await expect(page.locator('#statPayroll')).toHaveText(/^\$/);
  });

  test('payroll runs list shows the saved status and total of the current month run', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-payroll-runs');
    await page.evaluate(() => {
      PayrollApp.serverRuns = [{ id: 901, period_label: PayrollApp.month, status: 'finalized', total_net: 4321.5, headcount: 7, updated_at: '2026-09-30T10:00:00' }];
      PayrollApp.drawRunsList();
    });
    const row = page.locator('#payrollRunsTableBody tr').first();
    await expect(row).toContainText('Finalized');
    await expect(row).toContainText('$4,321.50');
    await expect(page.locator('#payrollRunsTableBody tr')).toHaveCount(1);
  });

  test('finalized run is read-only on step 2 and completed steps stay complete', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-payroll-runs');
    await page.evaluate(() => {
      PayrollApp.showPage('run');
      PayrollApp.currentRun = { id: 901, status: 'finalized', lines: [], exceptions: [] };
      PayrollApp.setStep(1);
    });
    await expect(page.locator('#payrollLockNote')).toBeVisible();
    await expect(page.locator('#btnP2SaveDraft')).toBeHidden();
    await expect(page.locator('#btnP2Approve')).toBeHidden();
    const plus = page.locator('#payrollTableBody .plus');
    if (await plus.count()) await expect(plus.first()).toBeHidden();
    // Steps 1 and 3 are done; step 2 is the active one but also complete (steps 1-3 all finished)
    await expect(page.locator('#payrollStepper .payroll-step-pill.done')).toHaveCount(2);
    await expect(page.locator('#payrollStepper .payroll-step-pill').nth(2)).toHaveClass(/done/);
    await expect(page.locator('#payrollStepper .payroll-step-pill').nth(3)).not.toHaveClass(/done/);
  });

  test('payment preview totals equal the sum of the rows', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-payroll-runs');
    const result = await page.evaluate(() => {
      PayrollApp.showPage('run');
      PayrollApp.drawScreen4();
      const sum = (col) => [...document.querySelectorAll('#payrollPaymentPreviewTableBody tr')]
        .reduce((a, tr) => a + Number(tr.children[col].textContent.replace(/[^0-9.\-]/g, '')), 0);
      return {
        ext: sum(3), int: sum(4), net: sum(5),
        fExt: document.getElementById('p4TotExt').textContent,
        fInt: document.getElementById('p4TotInt').textContent,
        fNet: document.getElementById('p4TotNet').textContent,
        cardNet: document.getElementById('p4TotalNet').textContent,
      };
    });
    expect(money(result.fExt)).toBeCloseTo(result.ext, 2);
    expect(money(result.fInt)).toBeCloseTo(result.int, 2);
    expect(money(result.fNet)).toBeCloseTo(result.net, 2);
    expect(money(result.cardNet)).toBeCloseTo(result.net, 2);
  });

  test('users role filter options come from the roles list', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-system-users', 'admin'));
    await expect(page.locator('#systemUsersRoleFilter option')).not.toHaveCount(1);
    expect(await page.locator('#systemUsersRoleFilter option').first().textContent()).toBe('All Roles');
  });
});
