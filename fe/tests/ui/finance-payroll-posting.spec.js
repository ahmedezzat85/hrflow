import { test, expect } from '@playwright/test';

// F5 (D-025). Real ledger rows, balances and refusals are covered by be/tests/test_finance_payroll_posting.py.
test.describe('Payroll paid moves net pay at once (F5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Mock disbursement drops the funding account balance by the net pay and is not posted twice', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const run = window.FinanceMockState.payrollRuns.find((r) => r.status === 'finalized');
      if (!run) return { skipped: true };
      const accId = run.external_funding_account_id || run.bank_account_id;
      const acc = window.FinanceMockState.accounts.find((a) => a.id === accId);
      const before = acc.current_balance;
      const net = (run.lines || []).reduce((s, l) => s + (l.net_pay || 0), 0);
      await window.FinanceApi.disbursePayrollRun(run.id);
      const afterPay = acc.current_balance;
      const journal = await window.FinanceApi.postPayrollJournal(run.id);
      return { before, net, afterPay, afterJournal: acc.current_balance, already: journal.is_already_posted, status: run.status };
    });
    test.skip(out.skipped, 'no finalized payroll run in the mock data');
    expect(out.status).toBe('paid');
    expect(out.afterPay).toBeCloseTo(out.before - out.net, 2);
    expect(out.afterJournal).toBe(out.afterPay);
    expect(out.already).toBe(true);
  });

  test('Mock disbursement is refused when the funding account has another currency', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const run = window.FinanceMockState.payrollRuns.find((r) => r.status === 'finalized');
      if (!run) return 'skipped';
      const egp = window.FinanceMockState.accounts.find((a) => a.currency === 'EGP');
      run.external_funding_account_id = egp.id;
      run.internal_funding_account_id = egp.id;
      try { await window.FinanceApi.disbursePayrollRun(run.id); return 'paid'; } catch (e) { return e.message; }
    });
    test.skip(msg === 'skipped', 'no finalized payroll run in the mock data');
    expect(msg).toContain('currency_mismatch');
  });
});
