import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';
import { confirmDialog } from './helpers/confirm.js';

async function openRun(page, url = '/?mock=admin') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function' && window.AdminNav);
  await openAdminPage(page, 'a-finance-payroll-runs');
  await page.evaluate(() => { PayrollApp.showPage('run'); PayrollApp.setStep(1); });
  await expect(page.locator('#payrollScreen2')).toBeVisible();
}

test.describe('U8 payroll journey', () => {
  test('Submit and Approve are two visible steps; self-approval needs the explicit box', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => {
      window.__approveArgs = [];
      const orig = FinanceApi.approvePayrollRun.bind(FinanceApi);
      FinanceApi.approvePayrollRun = (id, self) => { window.__approveArgs.push(self); return orig(id, self); };
    });
    const btn = page.locator('#btnP2Approve');
    await expect(btn).toContainText('Submit for approval');
    await expect(page.locator('#p2SelfApproveRow')).toBeHidden();
    await btn.click();
    await expect(btn).toContainText('Approve');
    await expect(page.locator('#payrollScreen2')).toBeVisible(); // still on screen 2: nothing approved yet
    await expect(page.locator('#p2SelfApproveRow')).toBeVisible(); // Super-Admin holds both permissions
    await btn.click();
    await expect(page.locator('#payrollScreen3')).toBeVisible();
    expect(await page.evaluate(() => window.__approveArgs)).toEqual([false]);
  });

  test('self-approval is sent only when ticked, and never for a user without both permissions', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => {
      window.__approveArgs = [];
      const orig = FinanceApi.approvePayrollRun.bind(FinanceApi);
      FinanceApi.approvePayrollRun = (id, self) => { window.__approveArgs.push(self); return orig(id, self); };
    });
    await page.click('#btnP2Approve');
    await page.check('#p2SelfApprove');
    await page.click('#btnP2Approve');
    await expect(page.locator('#payrollScreen3')).toBeVisible();
    expect(await page.evaluate(() => window.__approveArgs)).toEqual([true]);

    // A user who cannot both prepare and approve never sees the box and never sends true
    await openRun(page, '/?mock=finance');
    const canSelf = await page.evaluate(() => PayrollApp.canSelfApprove());
    expect(canSelf).toBe(false);
    await page.evaluate(() => {
      window.__approveArgs = [];
      const orig = FinanceApi.approvePayrollRun.bind(FinanceApi);
      FinanceApi.approvePayrollRun = (id, self) => { window.__approveArgs.push(self); return orig(id, self); };
      PayrollApp.currentRun = { id: 1, status: 'draft' };
      FinanceApi.submitPayrollRun = async () => ({});
    });
    await page.evaluate(async () => {
      await PayrollApp.submitRun();
      document.getElementById('p2SelfApproveRow').hidden = false;
      document.getElementById('p2SelfApprove').checked = true; // forced on
      await PayrollApp.approveRun();
    });
    expect(await page.evaluate(() => window.__approveArgs)).toEqual([false]);
  });

  test('recording payment always asks first; cancelling sends nothing', async ({ page }) => {
    await openRun(page);
    await page.click('#btnP2Approve');
    await page.click('#btnP2Approve');
    await expect(page.locator('#payrollScreen3')).toBeVisible();
    await page.evaluate(() => PayrollApp.setStep(4));
    await expect(page.locator('#payrollScreen5')).toBeVisible();
    await page.evaluate(() => {
      window.__pay = 0;
      const orig = FinanceApi.disbursePayrollRun.bind(FinanceApi);
      FinanceApi.disbursePayrollRun = (...a) => { window.__pay += 1; return orig(...a); };
    });
    await page.click('#btnP5ConfirmDisburse');
    const dialog = page.locator('#financeConfirmModal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#financeConfirmDescription')).toContainText('employees');
    await expect(page.locator('#financeConfirmDescription')).toContainText('missing bank details');
    await page.click('#financeConfirmModal .btn-ghost, #financeConfirmModal [onclick*="handleConfirmCancel"]');
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__pay)).toBe(0);
    await page.click('#btnP5ConfirmDisburse');
    await confirmDialog(page);
    await expect.poll(() => page.evaluate(() => window.__pay)).toBe(1);
  });

  test('payment cannot be recorded before the run is finalized', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => { PayrollApp.currentRun = { id: 5, status: 'submitted', lines: [] }; PayrollApp.setStep(4); });
    await expect(page.locator('#btnP5ConfirmDisburse')).toBeDisabled();
    await expect(page.locator('#p5ConfirmHint')).toContainText('finalized');
  });

  test('Export CSV on screen 4 downloads one row per employee', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => PayrollApp.setStep(3));
    await expect(page.locator('#payrollScreen4')).toBeVisible();
    const rows = await page.evaluate(() => PayrollApp.rows.length);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnP4ExportCsv')]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const text = await (async () => { const fs = await import('fs'); return fs.readFileSync(await download.path(), 'utf8'); })();
    expect(text.trim().split('\n')).toHaveLength(rows + 1);
  });

  test('the revert dialog uses the shared modal and validates inline', async ({ page }) => {
    await openRun(page);
    await page.evaluate(() => PayrollApp.openRevertModal());
    await expect(page.locator('#payrollRevertModal')).toBeVisible();
    await page.click('#payrollRevertModal .btn-danger');
    await expect(page.locator('#payrollRevertModal .field-error-msg')).toBeVisible();
    await page.evaluate(() => PayrollApp.closeRevertModal());
    await expect(page.locator('#payrollRevertModal')).toBeHidden();
  });

  test('phone layout: no horizontal scroll, compact stepper, card rows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function');
    await page.evaluate(() => showSection('a-finance-payroll-runs', 'admin'));
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1
      && document.querySelector('#a-finance-payroll').scrollWidth <= window.innerWidth + 1);
    await page.evaluate(() => { PayrollApp.showPage('list'); });
    expect(await noScroll()).toBe(true);
    await page.evaluate(() => { PayrollApp.showPage('run'); PayrollApp.setStep(1); });
    await expect(page.locator('.payroll-step-compact')).toBeVisible();
    await expect(page.locator('.payroll-step-compact')).toContainText('Step 2 of 6');
    expect(await noScroll()).toBe(true);
    const wsTop = await page.evaluate(() => document.querySelector('#payrollWorksheetTable').getBoundingClientRect().top);
    expect(wsTop).toBeLessThan(844 * 1.5);
    await page.evaluate(() => PayrollApp.setStep(3));
    expect(await noScroll()).toBe(true);
  });

  test('"New payroll run" starts a fresh run for the current month on step 1 (month can be changed)', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function' && window.AdminNav);
    await openAdminPage(page, 'a-finance-payroll-runs');
    await expect(page.locator('#btnStartNewRun')).toBeVisible();
    await page.evaluate(() => { PayrollApp.serverRuns = []; });
    await page.click('#btnStartNewRun');
    await expect(page.locator('#payrollScreen1')).toBeVisible();
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await expect(page.locator('#p1Month')).toHaveValue(ym);
    expect(await page.evaluate(() => PayrollApp.currentRun)).toBeNull();
    // changing the month moves start, end and pay date with it
    await page.fill('#p1Month', '2026-11');
    await page.dispatchEvent('#p1Month', 'change');
    await expect(page.locator('#p1Start')).toHaveValue('2026-11-01');
    await expect(page.locator('#p1End')).toHaveValue('2026-11-30');
    await expect(page.locator('#p1PayDate')).toHaveValue('2026-11-30');
  });

  test('"New payroll run" opens the existing run when the current month already has one', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function' && window.AdminNav);
    await openAdminPage(page, 'a-finance-payroll-runs');
    await page.evaluate(() => {
      const d = new Date();
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      window.__opened = null;
      PayrollApp.serverRuns = [{ id: 77, period_label: ym, status: 'finalized' }];
      PayrollApp.openHistoryRun = async (id) => { window.__opened = id; };
    });
    await page.click('#btnStartNewRun');
    await expect.poll(() => page.evaluate(() => window.__opened)).toBe(77);
  });
});
