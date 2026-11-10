import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Insurance claim payment (D-053, proposed). Mock mode (?mock=admin) keeps the claims in memory (session.js) and answers pay and
// reverse in api.js (_mockClaimPayment); accounts and payment types come from the finance mock layer. Real authorization,
// the ledger and the database are covered by the backend tests, not here.

const claim = (over) => ({
  id: 'CLM-1', employee_id: 2, employee_name: 'Mona Adel', category: 'Dental', provider: 'Clinic', amount: 1500, date: '2026-03-10',
  status: 'Approved', document_url: '', submitted_by: '', payment_status: 'unpaid', paid_at: null, ledger_transaction_id: null, ...over,
});

async function openInsurance(page, claims) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-insurance');
  await page.evaluate((rows) => { insuranceClaims = rows; renderInsuranceTable(); }, claims);
  await expect(page.locator('#insuranceTableBody tr').first()).toBeVisible();
  return errors;
}

const row = (page, name) => page.locator(`#insuranceTableBody tr:has-text("${name}")`);
const calls = (page) => page.evaluate(() => window._mockClaimPaymentCalls || []);

test.describe('Insurance claim payment', () => {
  test('shows the payment state and the right controls per claim', async ({ page }) => {
    const errors = await openInsurance(page, [
      claim({ id: 'CLM-1' }),
      claim({ id: 'CLM-2', employee_name: 'Old Claim', date: '2025-11-02' }),
      claim({ id: 'CLM-3', employee_name: 'Paid One', payment_status: 'paid', paid_at: '2026-05-01T10:00:00', ledger_transaction_id: 77 }),
      claim({ id: 'CLM-4', employee_name: 'Reversed One', payment_status: 'reversed', ledger_transaction_id: 78 }),
      claim({ id: 'CLM-5', employee_name: 'Pending One', status: 'Pending' }),
    ]);

    await expect(row(page, 'Mona Adel').locator('[data-claim-payment="unpaid"]')).toBeVisible();
    await expect(row(page, 'Mona Adel').locator('[data-action="record-claim-payment"]')).toBeVisible();

    await expect(row(page, 'Old Claim').locator('[data-claim-payment]')).toHaveCount(0);                  // before 2026: not touched or flagged
    await expect(row(page, 'Old Claim').locator('[data-action="record-claim-payment"]')).toHaveCount(0);

    await expect(row(page, 'Paid One').locator('[data-claim-payment="paid"]')).toContainText('Paid');
    await expect(row(page, 'Paid One').locator('[data-action="view-claim-ledger"]')).toBeVisible();
    await expect(row(page, 'Paid One').locator('[data-action="reverse-claim-payment"]')).toBeVisible();
    await expect(row(page, 'Paid One').locator('[data-action="record-claim-payment"]')).toHaveCount(0);

    await expect(row(page, 'Reversed One').locator('[data-claim-payment="reversed"]')).toBeVisible();
    await expect(row(page, 'Reversed One').locator('[data-action="record-claim-payment"]')).toBeVisible(); // can be paid again

    await expect(row(page, 'Pending One').locator('[data-claim-payment]')).toHaveCount(0);
    await expect(row(page, 'Pending One').locator('[data-action="record-claim-payment"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('payment modal: EGP accounts only, payment types follow the account type, amount and category are read-only', async ({ page }) => {
    await openInsurance(page, [claim()]);
    await page.locator('[data-action="record-claim-payment"]').click();
    const modal = page.locator('#claimPaymentModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#claimPayAmount')).toHaveAttribute('readonly', '');
    await expect(modal.locator('#claimPayCategory')).toHaveAttribute('readonly', '');
    await expect(modal.locator('#claimPayEmployee')).toHaveValue('Mona Adel');
    await expect(modal.locator('#claimPayDate')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

    await expect(modal.locator('#claimPayAccount option').first()).toBeAttached();
    const accounts = (await modal.locator('#claimPayAccount option').allTextContents()).join('|');
    expect(accounts).toContain('CIB EGP Operating');
    expect(accounts).toContain('Cairo Office Petty Cash Drawer');
    expect(accounts).not.toMatch(/USD|Overseas/);

    await expect(modal.locator('#claimPayType option').first()).toBeAttached();
    const bankTypes = (await modal.locator('#claimPayType option').allTextContents()).join('|');
    expect(bankTypes).not.toMatch(/Cheque|Check/i);
    await modal.locator('#claimPayAccount').selectOption({ label: 'Cairo Office Petty Cash Drawer' });
    await expect(modal.locator('#claimPayType option')).toHaveCount(1);
    await expect(modal.locator('#claimPayType option')).toContainText(/Cash/i);
    await modal.locator('#claimPaymentCancelBtn').click();
    await expect(modal).toBeHidden();
  });

  test('recording a payment sends only account, type, date and reference, then shows Paid', async ({ page }) => {
    await openInsurance(page, [claim()]);
    await page.locator('[data-action="record-claim-payment"]').click();
    const modal = page.locator('#claimPaymentModal');
    await expect(modal.locator('#claimPayType option').first()).toBeAttached();
    await modal.locator('#claimPayDate').fill('2026-05-02');
    await modal.locator('#claimPayReference').fill('TRX-9');
    await modal.locator('#claimPaymentSaveBtn').click();
    await expect(modal).toBeHidden();

    const sent = await calls(page);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('pay');
    expect(Object.keys(sent[0].body).sort()).toEqual(['account_id', 'payment_date', 'payment_type_id', 'reference']);
    expect(sent[0].body).toMatchObject({ payment_date: '2026-05-02', reference: 'TRX-9' });

    await expect(row(page, 'Mona Adel').locator('[data-claim-payment="paid"]')).toBeVisible();
    await expect(row(page, 'Mona Adel').locator('[data-action="view-claim-ledger"]')).toBeVisible();
    await expect(row(page, 'Mona Adel').locator('[data-action="record-claim-payment"]')).toHaveCount(0);
  });

  test('reversing needs a reason, sends it, and the claim can be paid again', async ({ page }) => {
    await openInsurance(page, [claim({ payment_status: 'paid', paid_at: '2026-05-01T10:00:00', ledger_transaction_id: 77 })]);
    await page.locator('[data-action="reverse-claim-payment"]').click();
    const confirm = page.locator('#financeConfirmModal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#financeConfirmSubmitBtn').click();
    expect(await calls(page)).toHaveLength(0);                                                               // blocked: no reason yet
    await confirm.locator('#financeConfirmReason').fill('Paid by mistake');
    await confirm.locator('#financeConfirmSubmitBtn').click();
    await expect(row(page, 'Mona Adel').locator('[data-claim-payment="reversed"]')).toBeVisible();
    expect(await calls(page)).toEqual([{ kind: 'reverse', claimId: 'CLM-1', body: { reason: 'Paid by mistake' } }]);
    await expect(row(page, 'Mona Adel').locator('[data-action="record-claim-payment"]')).toBeVisible();
  });

  test('controls are hidden without both permissions; the ledger link needs finance.account.read', async ({ page }) => {
    await openInsurance(page, [claim({ id: 'CLM-1' }), claim({ id: 'CLM-3', employee_name: 'Paid One', payment_status: 'paid', ledger_transaction_id: 77 })]);
    const setPerms = (perms) => page.evaluate((p) => { SessionInfo._permissions = p; renderInsuranceTable(); }, perms);

    await setPerms(['hr.insurance.read', 'hr.insurance.write']);                                              // no finance key
    await expect(page.locator('[data-action="record-claim-payment"]')).toHaveCount(0);
    await expect(page.locator('[data-action="reverse-claim-payment"]')).toHaveCount(0);
    await expect(page.locator('[data-action="view-claim-ledger"]')).toHaveCount(0);
    await expect(page.locator('[data-claim-payment="paid"]')).toBeVisible();                                  // the state itself stays visible

    await setPerms(['hr.insurance.read', 'finance.account.read', 'finance.account.write']);                  // no HR write key
    await expect(page.locator('[data-action="record-claim-payment"]')).toHaveCount(0);
    await expect(page.locator('[data-action="view-claim-ledger"]')).toBeVisible();

    await setPerms(['hr.insurance.read', 'hr.insurance.write', 'finance.account.read', 'finance.account.write']);
    await expect(page.locator('[data-action="record-claim-payment"]')).toBeVisible();
    await expect(page.locator('[data-action="reverse-claim-payment"]')).toBeVisible();
  });
});
