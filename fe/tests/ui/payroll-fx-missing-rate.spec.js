import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// FX-1: no silent 50.0000. A missing USD-EGP rate shows the backend message, says a rate is needed,
// and blocks saving the run until one is typed in.
test.describe('FX-1: missing payroll FX rate', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => console.log('PAGEERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-payroll');
  });

  test('a failed preview shows the message, "rate needed", and blocks saving', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const msg = 'No USD-EGP rate available for this period. Enter the rate manually.';
      let created = 0;
      FinanceApi.previewPayrollRun = async () => { throw new Error(msg); };
      FinanceApi.createPayrollRun = async () => { created += 1; return { id: 1, status: 'draft' }; };
      PayrollApp.fxRateValue = null;
      PayrollApp.fxResolved = false;
      await PayrollApp.fetchPreview();
      PayrollApp.drawFxRate();
      await PayrollApp.saveDraftRun();
      return { created, source: (document.getElementById('payrollFxRateSourceBadge') || {}).textContent || '' };
    });
    expect(result.created).toBe(0);
    expect(result.source).toContain('rate needed');
    await expect(page.locator('#payrollActionBanner')).toContainText('No USD-EGP rate available');
  });

  test('a typed rate unblocks saving and is sent as the manual rate', async ({ page }) => {
    const sent = await page.evaluate(async () => {
      let payload = null;
      FinanceApi.previewPayrollRun = async () => { throw new Error('No USD-EGP rate available for this period. Enter the rate manually.'); };
      FinanceApi.createPayrollRun = async (p) => { payload = p; return { id: 1, status: 'draft', lines: [] }; };
      PayrollApp.fxResolved = false;
      PayrollApp.fxRateValue = 51.25;
      await PayrollApp.saveDraftRun();
      return payload;
    });
    expect(sent).not.toBeNull();
    expect(sent.fx_rate_source).toBe('manual');
    expect(sent.fx_rate_value).toBe(51.25);
  });

  test('Step 1 explains where the rate comes from', async ({ page }) => {
    await expect(page.locator('#p1FxRateHint')).toHaveText('Type the rate the accountant used for this month');
  });
});
