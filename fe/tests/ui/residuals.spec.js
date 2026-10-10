import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// R7 seen-live residuals: each check covers one item that was still present on a fresh build.

async function boot(page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
}

async function openPaidRun(page) {
  await openAdminPage(page, 'a-finance-payroll');
  await page.evaluate(async () => {
    window.FinanceApi.getPayrollRun = async () => ({
      id: 202, period_label: '2026-03', status: 'paid', total_net: 30000, lines: [], exceptions: [],
    });
    window.FinanceApi.listStatutoryObligations = async () => [];
    await window.PayrollApp.openHistoryRun(202);
  });
}

test.describe('R7 residuals', () => {
  test('finalized run: step 1 fields are disabled and the FX and apply actions are gone', async ({ page }) => {
    await boot(page);
    await openPaidRun(page);
    await page.evaluate(() => window.PayrollApp.setStep(0));
    await expect(page.locator('#payrollScreen1')).toBeVisible();
    for (const id of ['p1Month', 'p1PayDate', 'p1Start', 'p1End', 'p1ExtAccount', 'p1IntAccount', 'p1FxRateInput']) {
      await expect(page.locator(`#${id}`), id).toBeDisabled();
    }
    for (const id of ['btnP1ApplyFx', 'btnP1ResetFx', 'btnToggleFxOverride']) {
      await expect(page.locator(`#${id}`), id).toBeHidden();
    }
  });

  test('paid run: step 2 does not tell the user to submit it', async ({ page }) => {
    await boot(page);
    await openPaidRun(page);
    await page.evaluate(() => window.PayrollApp.setStep(1));
    await expect(page.locator('#p2ApprovalHint')).not.toContainText('Step 1 of 2');
    await expect(page.locator('#p2ApprovalHint')).toContainText('approved');
    await expect(page.locator('#btnP2Approve')).toBeHidden();
  });

  test('Sales, Banking and Bills tables keep the Actions column inside the card at 1440px', async ({ page }) => {
    await boot(page);
    for (const id of ['a-finance-invoices', 'a-finance-accounts', 'a-finance-bills']) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await page.waitForTimeout(500);
      const ok = await page.evaluate((p) => {
        const table = document.querySelector(`#${p} table.sticky-actions`);
        const wrap = table.parentElement.getBoundingClientRect();
        const last = [...table.querySelectorAll('thead th')].filter((t) => t.offsetParent).pop().getBoundingClientRect();
        return last.right <= wrap.right + 1;
      }, id);
      expect(ok, id).toBe(true);
    }
  });

  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`New Sales Invoice line items do not scroll sideways at ${size.width}px`, async ({ page }) => {
      await boot(page, size);
      await page.evaluate(() => { showSection('a-finance-invoices', 'admin'); openAddInvoiceModal(); });
      const m = await page.evaluate(() => {
        const body = document.querySelector('#invoiceModal .modal-body') || document.getElementById('invoiceModal');
        return { scroll: body.scrollWidth, client: body.clientWidth };
      });
      expect(m.scroll).toBeLessThanOrEqual(m.client);
    });
  }

  test('Statutory summary cards sit side by side at 1440px', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showSection('a-finance-statutory', 'admin'));
    await page.waitForTimeout(500);
    const tops = await page.locator('#a-finance-statutory .fv-cards > .fv-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(1);
  });

  test('switching report tabs updates the URL', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showSection('a-finance-reports', 'admin'));
    await page.waitForTimeout(500);
    await page.evaluate(() => openReportFromLibrary('category-summary'));
    await page.locator('[data-report-tab="balances"]').first().click();
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('/finance/reports/balances');
  });

  test('bank account modal takes focus and closes on Escape', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showSection('a-employee-detail', 'admin'); currentDetailEmployeeId = 1; openBankAccountModal(); });
    await expect(page.locator('#bankAccountModal')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('#bankAccountModal'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#bankAccountModal')).not.toHaveClass(/active/);
  });

  test('wording no longer implies transfers, feeds, OCR or sending', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(() => document.documentElement.innerHTML);
    for (const gone of ['Confirm &amp; Remit Payment', 'Document Capture &amp; OCR', 'Law 148', 'External Wire Account', 'Approve &amp; Send', 'Egyptian Tax Authority (EETAX)']) {
      expect(html, gone).not.toContain(gone);
    }
    const label = await page.evaluate(() => _paymentTypeLabel({ payment_type_code: 'OUTBOUND_TRANS' }));
    expect(label).toBe('Outbound trans');
  });
});
