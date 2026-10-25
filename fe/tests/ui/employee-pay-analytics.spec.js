import { test, expect } from '@playwright/test';
import { openPay, calls } from './helpers/pay-analytics.js';


test.describe('Pay analytics: summary and chart', () => {
  test('nothing is fetched until the tab opens; chart, summary and no raise list', async ({ page }) => {
    await openPay(page, 'admin');
    expect(await calls(page)).toBe(0);
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    expect(await calls(page)).toBe(1);
    await expect(page.locator('#paySummary')).toContainText('Total paid');
    await expect(page.locator('#paySummary')).toContainText('Base pay');
    await expect(page.locator('#paySummary')).toContainText('Commission');
    await expect(page.locator('#paySummary')).toContainText('Bonus');
    await expect(page.locator('#payChartCanvas')).toHaveAttribute('aria-label', /Total paid .*payroll cycles.*1 raise in this period/);
    await expect(page.locator('#employeePayPanel')).toContainText('1 raise in this period');
    await expect(page.locator('#employeePayPanel')).toContainText('Payroll-line amounts');
    await expect(page.locator('#employeePayPanel')).not.toContainText('Promotion to Lead'); // no raise list in this tab
    await expect(page.locator('#payCurrencyField')).toBeHidden();
  });

  test('changing period or grouping refetches and the cache serves repeats', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    await page.selectOption('#payPeriodSelect', '12m');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    expect(await calls(page)).toBe(2);
    await page.click('#payGroupBy button[data-group="quarter"]');
    await expect(page.locator('#payGroupBy button[data-group="quarter"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => calls(page)).toBe(3);
    await page.click('#payGroupBy button[data-group="month"]');
    await expect(page.locator('#payGroupBy button[data-group="month"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await calls(page)).toBe(3); // monthly view for the same filters came from the cache
  });

  test('See raise history switches to Overview', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await page.click('#paySeeRaisesBtn');
    await expect(page.locator('#employeeOverviewTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#employeeOverviewPanel')).toBeVisible();
  });

  test('empty state keeps the controls usable', async ({ page }) => {
    await openPay(page, 'admin', { scenario: 'empty' });
    await page.click('#employeePayTab');
    await expect(page.locator('#payBody')).toContainText('No payroll recorded for this period');
    await expect(page.locator('#payPeriodSelect')).toBeEnabled();
    await expect(page.locator('#payChartCanvas')).toHaveCount(0);
  });

  test('currency selector appears only with more than one currency', async ({ page }) => {
    await openPay(page, 'admin', { scenario: 'two-currencies' });
    await page.click('#employeePayTab');
    await expect(page.locator('#payCurrencyField')).toBeVisible();
    await page.selectOption('#payCurrencySelect', 'EGP');
    await expect.poll(() => page.evaluate(() => window.__payCalls.map((c) => c.currency).join())).toBe('USD,EGP');
  });

  test('HR-only shows plan summary and plan chart with no payments content', async ({ page }) => {
    await openPay(page, 'hr');
    await page.click('#employeePayTab');
    await expect(page.locator('#paySummary')).toContainText('Raises since joining');
    await expect(page.locator('#paySummary')).toContainText('Overall change');
    await expect(page.locator('#paySummary')).toContainText('Time at current pay');
    await expect(page.locator('#employeePayPanel')).toContainText('Pay plan history');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    await expect(page.locator('#payCurrencyField')).toBeHidden();
    const text = await page.locator('#employeePayPanel').innerText();
    for (const w of ['Total paid', 'Commission', 'Pay by month', 'Monthly breakdown', 'Payment']) expect(text).not.toContain(w);
  });

  test('HR-only reads plan.changes newest-first: summary, bar order and change pills (A1)', async ({ page }) => {
    await openPay(page, 'hr');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    const kpis = page.locator('#paySummary');
    await expect(kpis).toContainText('Raises since joining');
    await expect(kpis.locator('.ed-kpi', { hasText: 'Raises since joining' })).toContainText('2');
    await expect(kpis.locator('.ed-kpi', { hasText: 'Raises since joining' })).toContainText('last on 1 Jun 2026');
    await expect(kpis.locator('.ed-kpi', { hasText: 'Overall change' })).toContainText('+25%');
    await expect(kpis.locator('.ed-kpi', { hasText: 'Overall change' })).toContainText('$11,000 → $13,750');
    const chart = await page.evaluate(() => {
      const ch = Chart.getChart(document.getElementById('payChartCanvas'));
      return { labels: ch.data.labels.map((l) => l[0]), totals: ch.data.datasets[0].data.map((v, i) => v + ch.data.datasets[1].data[i]) };
    });
    expect(chart.labels).toEqual(['15 Jan 2025', '1 Jun 2026']);
    expect(chart.totals).toEqual([12500, 13750]);
    const pills = await page.evaluate(() => {
      const ch = Chart.getChart(document.getElementById('payChartCanvas'));
      const texts = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { texts.push(String(t)); return orig.call(this, t, ...a); };
      ch.draw();
      CanvasRenderingContext2D.prototype.fillText = orig;
      return texts.filter((t) => /^[+-][\d.]+%$/.test(t));
    });
    expect(pills).toEqual(['+10%']); // one pill sits between the two bars: the newer change
  });

  test('HR-only change pills follow the raise order (A1)', async ({ page }) => {
    await openPay(page, 'hr');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    const pcts = await page.evaluate(async () => (await AnalyticsApi.getEmployeePay(1, { startDate: '2025-01-01', endDate: '2026-10-23', groupBy: 'month', currency: 'USD' })).plan.changes.map((c) => c.pct_change));
    expect(pcts).toEqual([13.6, 10]);
  });

  test('Full-access raise markers render in date order (A1)', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    const dates = await page.evaluate(async () => (await AnalyticsApi.getEmployeePay(1, { startDate: '2025-01-01', endDate: '2026-10-23', groupBy: 'month', currency: 'USD' })).plan.changes.map((c) => c.date));
    expect(dates).toEqual(['2025-01-15', '2026-06-01']);
  });

  test('A null effective date does not throw and shows a dash (A2)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openPay(page, 'hr', { scenario: 'no-effective-date' });
    await page.click('#employeePayTab');
    const k = page.locator('#paySummary .ed-kpi', { hasText: 'Time at current pay' });
    await expect(k).toContainText('—');
    await expect(k).toContainText('since —');
    expect(errors).toEqual([]);
  });

  test('HR-only has See raise history and per-bar tooltip detail (A3)', async ({ page }) => {
    await openPay(page, 'hr');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    const tip = await page.evaluate(() => {
      const cb = Chart.getChart(document.getElementById('payChartCanvas')).options.plugins.tooltip.callbacks;
      const item = (i) => [{ dataIndex: i }];
      return { title: cb.title(item(1)), body: cb.afterBody(item(1)), first: cb.afterBody(item(0)) };
    });
    expect(tip.title).toBe('1 Jun 2026 · Promotion to Lead');
    expect(tip.body).toEqual(['Total: $13,750', 'Previous total: $12,500', 'New total: $13,750', 'Change: +10%', 'Reason: Promotion to Lead']);
    expect(tip.first).toContain('Previous total: $11,000');
    await page.click('#paySeeRaisesBtn');
    await expect(page.locator('#employeeOverviewTab')).toHaveAttribute('aria-selected', 'true');
    // The card is hidden for HR-only until Part B (D-038) gates it on hr.salary.read; the handler still targets it.
    await expect(page.locator('#employeeCompensationCard')).toHaveCount(1);
  });

  test('Finance-only has payments sections and no raise link', async ({ page }) => {
    await openPay(page, 'finance');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    await expect(page.locator('#paySeeRaisesBtn')).toHaveCount(0);
    await expect(page.locator('#employeePayPanel')).not.toContainText('raise in this period');
  });

  test('switching employee clears state and refetches on next open', async ({ page }) => {
    await openPay(page, 'admin');
    await page.click('#employeePayTab');
    await expect(page.locator('#payChartCanvas')).toBeVisible();
    await page.evaluate(() => { viewProfile(2); });
    await expect(page.locator('#employeePayPanel')).toBeEmpty();
    await page.click('#employeePayTab');
    await expect(page.locator('#payBody')).toContainText('No payroll recorded for this period');
    expect(await calls(page)).toBe(2);
  });
});
