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
