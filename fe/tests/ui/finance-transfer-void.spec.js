import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// D-054: a wrong transfer is voided with one action; both balances come back and the transfer disappears from the list (mock mode).
test.describe('Void a transfer', () => {
  test('one void restores both balances, needs a reason, and hides the transfer', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-accounts');

    const setup = await page.evaluate(async () => {
      const accounts = FinanceMockState.accounts;
      const from = accounts.find((a) => accounts.some((b) => b.id !== a.id && b.currency === a.currency));
      const to = accounts.find((b) => b.id !== from.id && b.currency === from.currency);
      const before = { from: from.current_balance, to: to.current_balance };
      const t = await FinanceApi.createTransfer({
        from_account_id: from.id, to_account_id: to.id, date: '2026-10-05', from_amount: 123, from_currency: from.currency,
        transfer_type: 'internal', exchange_reference: 'VOID-ME',
      });
      return { id: t.id, from: from.id, to: to.id, before, after: { from: from.current_balance, to: to.current_balance } };
    });
    expect(setup.after.from).toBe(setup.before.from - 123);
    expect(setup.after.to).toBe(setup.before.to + 123);

    await page.evaluate(() => switchFinanceAccountsSubTab('transfers'));
    const row = page.locator('#financeTransfersTableBody tr', { hasText: 'VOID-ME' });
    await expect(row).toHaveCount(1);
    await row.locator('.btn-void-transfer').click();

    const dialog = page.locator('#financeConfirmModal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#financeConfirmReasonGroup')).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');                       // no reason: refused
    await expect(dialog).toBeVisible();
    await page.fill('#financeConfirmReason', 'Entered the wrong amount');
    await page.click('#financeConfirmSubmitBtn');
    await expect(dialog).toBeHidden();

    await expect(page.locator('#financeTransfersTableBody tr', { hasText: 'VOID-ME' })).toHaveCount(0);   // hidden by default
    const result = await page.evaluate(({ id, from, to }) => {
      const acc = (i) => FinanceMockState.accounts.find((a) => a.id === i).current_balance;
      const tr = FinanceMockState.transfers.find((t) => t.id === id);
      return { from: acc(from), to: acc(to), legs: FinanceMockState.transactions.filter((t) => t.linked_transfer_id === id).length, voided: !!tr.voided_at, reason: tr.void_reason };
    }, setup);
    expect(result).toEqual({ from: setup.before.from, to: setup.before.to, legs: 0, voided: true, reason: 'Entered the wrong amount' });

    // a second void is refused, and the voided transfer is listed only on request
    const second = await page.evaluate(async (id) => { try { await FinanceApi.voidTransfer(id, 'Again please'); return 'accepted'; } catch (e) { return e.message; } }, setup.id);
    expect(second).toContain('already voided');
    expect(await page.evaluate(async (id) => (await FinanceApi.getTransfers({ include_voided: true })).some((t) => t.id === id), setup.id)).toBe(true);
    expect(await page.evaluate(async (id) => (await FinanceApi.getTransfers()).some((t) => t.id === id), setup.id)).toBe(false);
  });
});
