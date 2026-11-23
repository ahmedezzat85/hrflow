import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// INV-REFUND-1: reversing a customer receipt as of the date the money went back, from the invoice drawer.
// Mock mode reproduces the visible rules; real authorization, the closed-month lock and ledger posting are covered by
// be/tests/test_finance_invoice_refund.py.
const RECEIPT_DATE = '2026-09-15';

test.describe('Invoice receipt reversal with a date and a kind (INV-REFUND-1)', () => {
  test.beforeEach(async ({ page }) => {
    page.errors = [];
    page.on('pageerror', (err) => page.errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.location().url.endsWith('/favicon.ico')) page.errors.push(msg.text()); });
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
  });

  async function payInvoiceInFull(page, reference) {
    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    await page.locator('#paymentAmount').fill('12500.00');
    await page.locator('#paymentDate').fill(RECEIPT_DATE);
    await page.locator('#paymentReference').fill(reference);
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.click('#invoicePaymentSubmitBtn');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();
  }

  async function openReceiptsInDrawer(page) {
    await page.evaluate(() => window.FinanceDrawer.open('invoice', 1));
    await page.locator('#financeDrawerTablist [data-drawer-tab="related"]').click();
    await expect(page.locator('#financeDrawerRelatedList .related-record-card').first()).toBeVisible();
  }

  const today = () => new Date().toISOString().slice(0, 10);

  test('The dialog asks for kind, date and a required reason, and states the consequence', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-DLG-1');
    await openReceiptsInDrawer(page);
    await page.locator('#financeDrawerRelatedList .btn-reverse-receipt').first().click();

    const modal = page.locator('#invoiceRefundModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#invoiceRefundKindRefund')).toBeChecked();
    await expect(modal.locator('#invoiceRefundKindCorrection')).not.toBeChecked();
    const date = modal.locator('#invoiceRefundDate');
    await expect(date).toHaveValue(today());
    await expect(date).toHaveAttribute('max', today());
    await expect(date).toHaveAttribute('min', RECEIPT_DATE);

    // submit stays disabled until the reason is filled
    await expect(modal.locator('#invoiceRefundSubmitBtn')).toBeDisabled();
    await modal.locator('#invoiceRefundReason').fill('Customer asked for the money back');
    await expect(modal.locator('#invoiceRefundSubmitBtn')).toBeEnabled();

    // the consequence names the amount and the date, not just "debits the account"
    await date.fill('2026-10-01');
    await expect(modal.locator('#invoiceRefundConsequence')).toContainText('refund of');
    await expect(modal.locator('#invoiceRefundConsequence')).toContainText('2026-10-01');
    await expect(modal.locator('#invoiceRefundConsequence')).toContainText('12,500.00');
    await modal.locator('#invoiceRefundKindCorrection').check();
    await expect(modal.locator('#invoiceRefundConsequence')).toContainText('reversal of');

    await page.click('#invoiceRefundModal .modal-close');
    await expect(modal).not.toBeVisible();
    await page.click('#financeDetailDrawerCloseBtn');
  });

  test('A date before the receipt or in the future is blocked and nothing is reversed', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-DATE-1');
    await openReceiptsInDrawer(page);
    await page.locator('#financeDrawerRelatedList .btn-reverse-receipt').first().click();
    const modal = page.locator('#invoiceRefundModal');
    await modal.locator('#invoiceRefundReason').fill('Wrong date test');

    await modal.locator('#invoiceRefundDate').fill('2026-09-01');
    await modal.locator('#invoiceRefundSubmitBtn').click();
    await expect(modal.locator('#invoiceRefundDate_error')).toContainText('before the receipt date');
    await expect(modal).toBeVisible();

    await modal.locator('#invoiceRefundDate').fill('2999-01-01');
    await modal.locator('#invoiceRefundSubmitBtn').click();
    await expect(modal.locator('#invoiceRefundDate_error')).toContainText('in the future');

    const live = await page.evaluate(async () => (await window.FinanceApi.getInvoicePayments(1)).filter((p) => !p.is_reversed).length);
    expect(live).toBe(1);

    await page.click('#invoiceRefundModal .modal-close');
    await page.click('#financeDetailDrawerCloseBtn');
  });

  test('Mock API applies the same date rules', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-MOCK-1');
    const results = await page.evaluate(async () => {
      const pay = (await window.FinanceApi.getInvoicePayments(1)).find((p) => p.reference === 'REFUND-MOCK-1');
      const attempt = async (date, kind) => {
        try {
          await window.FinanceApi.reverseInvoicePayment(1, pay.id, 'x', date, kind);
          return 'ok';
        } catch (e) {
          return (e.detail && e.detail.code) || e.message;
        }
      };
      return [await attempt('13/05/2026', 'refund'), await attempt('2999-01-01', 'refund'), await attempt('2026-09-14', 'refund'), await attempt('2026-10-01', 'gift')];
    });
    expect(results).toEqual(['reversal_date_invalid', 'reversal_date_future', 'reversal_date_before_receipt', 'reversal_kind_invalid']);
  });

  test('A refund shows "Refunded on <date>" with its reason, reopens the invoice and offers Void', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-FLOW-1');
    await openReceiptsInDrawer(page);
    await page.locator('#financeDrawerRelatedList .btn-reverse-receipt').first().click();

    const modal = page.locator('#invoiceRefundModal');
    await modal.locator('#invoiceRefundKindRefund').check();
    await modal.locator('#invoiceRefundDate').fill('2026-10-01');
    await modal.locator('#invoiceRefundReason').fill('Contract cancelled, money returned');
    await modal.locator('#invoiceRefundSubmitBtn').click();

    await expect(modal).not.toBeVisible();
    await expect(page.locator('#toastWrap')).toContainText('can now be voided');

    // the drawer is refreshed: the receipt is marked refunded on its date, with the reason, and has no Reverse button
    const card = page.locator('#financeDrawerRelatedList .related-record-card:has-text("REVERSED")');
    await expect(card).toContainText('Refunded on 2026-10-01');
    await expect(card).toContainText('Contract cancelled, money returned');
    await expect(page.locator('#financeDrawerRelatedList .btn-reverse-receipt')).toHaveCount(0);
    await page.click('#financeDetailDrawerCloseBtn');

    // the invoice is Sent again, with the balance restored, and can be voided
    await page.click('#tabQueueAll');
    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await expect(row).toContainText('Sent');
    await expect(row).toContainText('12,500.00');
    await expect(row.locator('button[title="Void Invoice"]')).toBeVisible();

    const rec = await page.evaluate(async () => (await window.FinanceApi.getInvoicePayments(1)).find((p) => p.reference === 'REFUND-FLOW-1'));
    expect([rec.is_reversed, rec.reversal_date, rec.reversal_kind]).toEqual([true, '2026-10-01', 'refund']);
    expect(page.errors).toEqual([]);   // no console or page errors on the invoice screen
  });

  test('"Entered by mistake" is stored as a correction and shown as Reversed', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-CORR-1');
    await openReceiptsInDrawer(page);
    await page.locator('#financeDrawerRelatedList .btn-reverse-receipt').first().click();
    const modal = page.locator('#invoiceRefundModal');
    await modal.locator('#invoiceRefundKindCorrection').check();
    await modal.locator('#invoiceRefundReason').fill('Posted twice');
    await modal.locator('#invoiceRefundSubmitBtn').click();
    await expect(modal).not.toBeVisible();
    await expect(page.locator('#financeDrawerRelatedList .related-record-card:has-text("REVERSED")')).toContainText(`Reversed on ${today()}`);
    await page.click('#financeDetailDrawerCloseBtn');
  });

  test('The Reverse control is hidden without finance.invoice.write', async ({ page }) => {
    await payInvoiceInFull(page, 'REFUND-PERM-1');
    await page.evaluate(() => {
      const original = SessionInfo.hasPermission.bind(SessionInfo);
      SessionInfo.hasPermission = (key) => (key === 'finance.invoice.write' ? false : original(key));
    });
    await openReceiptsInDrawer(page);
    await expect(page.locator('#financeDrawerRelatedList .related-record-card:has-text("Payment #")').first()).toBeVisible();
    await expect(page.locator('#financeDrawerRelatedList .btn-reverse-receipt')).toHaveCount(0);
    await page.click('#financeDetailDrawerCloseBtn');
  });
});
