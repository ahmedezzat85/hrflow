import { test, expect } from '@playwright/test';

const F = { startDate: '2025-11-01', endDate: '2026-10-23', groupBy: 'month', currency: 'USD' };

async function pay(page, mock, empId = 1, over = {}, scenario = '') {
  await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AnalyticsApi && window.Router);
  return page.evaluate(async ([id, f, s]) => { window.__payFixture = s; return AnalyticsApi.getEmployeePay(id, f); }, [empId, { ...F, ...over }, scenario]);
}

test.describe('AnalyticsApi mock fixtures', () => {
  test('full access has plan and payments and sums agree', async ({ page }) => {
    const d = await pay(page, 'admin');
    expect(d.plan.changes).toHaveLength(2);
    expect(d.currencies_available).toEqual(['USD']);
    const s = d.payments.series;
    expect(s.find((b) => b.bucket === '2026-02')).toBeUndefined(); // gap month is absent, not zero
    expect(d.payments.totals.total).toBeCloseTo(s.reduce((a, b) => a + b.total, 0), 2);
    expect(d.payments.totals.cycles).toBe(s.length);
  });

  test('HR-only has no payments key and finance-only has no plan key', async ({ page }) => {
    const hr = await pay(page, 'hr');
    expect(hr.plan).toBeTruthy();
    expect('payments' in hr).toBe(false);
    expect('currencies_available' in hr).toBe(false);
    const fin = await pay(page, 'finance');
    expect(fin.payments.series.length).toBeGreaterThan(0);
    expect('plan' in fin).toBe(false);
  });

  test('quarterly grouping preserves totals; empty and two-currency scenarios', async ({ page }) => {
    const m = await pay(page, 'admin');
    const q = await pay(page, 'admin', 1, { groupBy: 'quarter' });
    expect(q.payments.series.length).toBeLessThan(m.payments.series.length);
    expect(q.payments.totals.total).toBeCloseTo(m.payments.totals.total, 2);
    const empty = await pay(page, 'admin', 1, {}, 'empty');
    expect(empty.payments.series).toEqual([]);
    expect(empty.plan.current).toBeNull();
    const two = await pay(page, 'admin', 1, { currency: 'EGP' }, 'two-currencies');
    expect(two.currencies_available).toEqual(['USD', 'EGP']);
    expect(two.payments.totals.total).toBeGreaterThan(0);
  });
});
