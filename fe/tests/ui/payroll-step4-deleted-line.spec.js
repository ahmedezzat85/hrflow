import { test, expect } from '@playwright/test';
import { submitAndApprove } from './helpers/payroll.js';
import { openAdminPage } from './helpers/admin-nav.js';

// A line removed from a saved run takes the employee off the payment screens (4 and 5). Before the fix screen 4
// kept showing the employee's plan amount, so its totals did not match the run the backend pays.

async function toStep4(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-finance-payroll');
  await page.click('#btnOpenCurrentCycle');
  await page.click('#btnP1Proceed');
  await submitAndApprove(page);
  await page.click('#btnP3Next');
  await expect(page.locator('#payrollScreen4')).toBeVisible();
  await expect(page.locator('#payrollPaymentPreviewTableBody tr').first()).toBeVisible();
}

const readScreen4 = (page) => page.evaluate(() => {
  const num = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));
  return {
    names: [...document.querySelectorAll('#payrollPaymentPreviewTableBody tr')].map((tr) => tr.querySelector('td').textContent.trim()),
    total: num(document.getElementById('p4TotalNet').textContent),
    headcount: num(document.getElementById('p4Headcount').textContent),
  };
});

test.describe('payroll payment preview after a line is deleted from the run', () => {
  test('an employee with no line on the saved run is not shown or counted on screen 4', async ({ page }) => {
    await toStep4(page);
    // The mock run carries lines for other employee ids; give it one line per rostered employee, like a real run.
    await page.evaluate(() => {
      const app = window.PayrollApp;
      app.currentRun.lines = app.rows.map((r, i) => ({ id: 900 + i, employee_id: r.id, compensation_type: 'internal_usd_cash', net_pay: 1000 + i * 100, base_salary: 1000 + i * 100 }));
      app.drawScreen4();
    });
    const before = await readScreen4(page);
    expect(before.names.length).toBeGreaterThan(1);

    const removed = await page.evaluate(() => {
      const app = window.PayrollApp;
      const victim = app.rows.find((r) => app.currentRun.lines.some((l) => Number(l.employee_id) === Number(r.id)));
      app.currentRun.lines = app.currentRun.lines.filter((l) => Number(l.employee_id) !== Number(victim.id));
      app.drawScreen4();
      return { id: victim.id, name: victim.name };
    });

    const after = await readScreen4(page);
    expect(after.names).not.toContain(removed.name);
    expect(after.names.length).toBe(before.names.length - 1);
    expect(after.headcount).toBe(before.headcount - 1);
    expect(after.total).toBeLessThan(before.total);

    // the total is exactly what the remaining run lines pay
    const fromLines = await page.evaluate(() =>
      window.PayrollApp.currentRun.lines.reduce((s, l) => s + Number(l.net_pay || l.amount || 0), 0));
    expect(Math.abs(after.total - Math.round(fromLines))).toBeLessThanOrEqual(1);
  });

  test('without a saved run everyone eligible is still shown', async ({ page }) => {
    await toStep4(page);
    const n = await page.evaluate(() => {
      const app = window.PayrollApp;
      app.currentRun = null;
      return { rows: app.rows.length, payRows: app.payRows().length };
    });
    expect(n.payRows).toBe(n.rows);
  });
});
