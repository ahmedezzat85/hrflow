import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// A bonus on a run that is already saved as a draft goes to the run on the server (mock mode mirrors the endpoints),
// and a reopened run shows the bonuses saved on it.
test.describe('Payroll: bonuses on a saved draft run', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-payroll');
    await page.click('#btnOpenCurrentCycle');
    await page.click('#btnP1Proceed');
    await expect(page.locator('#payrollScreen2')).toBeVisible();
    await expect(page.locator('#payrollTableBody tr').first()).toBeVisible();
  });

  async function saveAs(page, status) {
    await page.evaluate((status) => {
      FinanceMockState.payrollRuns.unshift({ id: 9100, period_label: PayrollApp.month, period_start: PayrollApp.start, period_end: PayrollApp.end, status, total_net: 1000, adjustments: [], lines: [], exceptions: [] });
      PayrollApp.currentRun = { id: 9100, status };
    }, status);
  }

  async function addBonus(page, amount) {
    const row = page.locator('#payrollTableBody tr:not(.expand)').first();
    await row.locator('.col-actions .plus').click();
    const id = (await row.locator('.col-id').textContent()).trim();
    await page.fill(`#inlineBonusAmount_${id}`, String(amount));
    await page.click(`#btnSubmitInlineBonus_${id}`);
    return id;
  }

  test('adding and removing a bonus calls the run endpoints, not the preview', async ({ page }) => {
    await saveAs(page, 'draft');
    const id = await addBonus(page, 321);
    await expect.poll(() => page.evaluate(() => FinanceMockState.payrollRuns.find((r) => r.id === 9100).adjustments.map((a) => [a.employee_id, a.amount, a.status]))).toEqual([[Number(id), 321, 'DRAFT']]);
    expect(await page.evaluate((id) => PayrollApp.rows.find((r) => String(r.id) === id).bonuses.map((b) => b.amount), id)).toEqual([321]);

    const adjId = await page.evaluate(() => FinanceMockState.payrollRuns.find((r) => r.id === 9100).adjustments[0].id);
    await page.evaluate(async ({ id, adjId }) => { await PayrollApp.deleteBonus(Number(id), 0, adjId); }, { id, adjId });
    expect(await page.evaluate(() => FinanceMockState.payrollRuns.find((r) => r.id === 9100).adjustments.length)).toBe(0);
    expect(await page.evaluate((id) => PayrollApp.rows.find((r) => String(r.id) === id).bonuses.length, id)).toBe(0);
  });

  test('a run that is not a draft refuses the bonus and the screen shows why', async ({ page }) => {
    await saveAs(page, 'approved');
    const id = await addBonus(page, 50);
    await expect(page.locator('#payrollBanner, .pv-banner, [id*="anner"]').filter({ hasText: 'Revert it to draft' }).first()).toBeVisible();
    expect(await page.evaluate(() => FinanceMockState.payrollRuns.find((r) => r.id === 9100).adjustments.length)).toBe(0);
    expect(await page.evaluate((id) => PayrollApp.rows.find((r) => String(r.id) === id).bonuses.length, id)).toBe(0);
  });

  test('reopening a saved run shows the bonuses saved on it', async ({ page }) => {
    const id = await page.evaluate(() => PayrollApp.rows[0].id);
    await page.evaluate((id) => {
      FinanceMockState.payrollRuns.unshift({ id: 9101, period_label: PayrollApp.month, period_start: PayrollApp.start, period_end: PayrollApp.end, status: 'draft', adjustments: [
        { id: 'adj_a', employee_id: id, type: 'BONUS', amount: 275, payment_source: 'INT', description: 'Bonus' },
        { id: 'adj_b', employee_id: id, type: 'COMMISSION', amount: 40, payment_source: 'EXT', description: 'Support Commission' },
      ], lines: [], exceptions: [] });
    }, id);
    await page.evaluate(async () => { await PayrollApp.openHistoryRun(9101); });
    const bonuses = await page.evaluate((id) => PayrollApp.rows.find((r) => r.id === id).bonuses.map((b) => [b.id, b.type, b.amount, b.source]), id);
    expect(bonuses).toEqual([['adj_a', 'Bonus', 275, 'internal'], ['adj_b', 'Support Commission', 40, 'external']]);
  });
});
