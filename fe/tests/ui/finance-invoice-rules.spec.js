import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance Review Round 2, slice F1 (D-022). Mock mode reproduces the visible rules; real authorization,
// ledger posting and balances are covered by be/tests/test_finance_invoice_rules.py.
test.describe('Sales invoice status and safety rules (F1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
  });

  const row = (page, number) => page.locator(`#financeInvoicesTableBody tr:has-text("${number}")`);

  test('Overdue is a flag: an overdue sent invoice keeps the Sent status and shows the overdue badge', async ({ page }) => {
    const r = row(page, 'INV-2026-003');
    await expect(r).toContainText('Sent');
    await expect(r).toContainText('overdue');
  });

  test('Receipt dialog offers only same-currency accounts and incoming payment types', async ({ page }) => {
    await row(page, 'INV-2026-001').locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    const accounts = (await page.locator('#paymentBankAccountId option').allTextContents()).join(' ');
    expect(accounts).toContain('USD');
    expect(accounts).not.toContain('EGP');
    await expect(page.locator('#paymentTypeId')).toContainText('Incoming Transfer');
    const types = (await page.locator('#paymentTypeId option').allTextContents()).join(' ');
    expect(types).not.toContain('Outgoing');
    await page.click('#invoicePaymentModal .modal-close');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();
  });

  test('A partial receipt makes the invoice Partially Paid and removes the void action', async ({ page }) => {
    const r = row(page, 'INV-2026-001');
    await expect(r.locator('button[title="Void Invoice"]')).toBeVisible();
    await r.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.fill('#paymentAmount', '1000');
    await page.click('#invoicePaymentSubmitBtn');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    const after = row(page, 'INV-2026-001');
    await expect(after).toContainText('Partially Paid');
    await expect(after.locator('button[title="Void Invoice"]')).toHaveCount(0);
  });

  test('A seeded partly paid invoice cannot be voided from the row and still accepts receipts', async ({ page }) => {
    const r = row(page, 'INV-2026-004');
    await expect(r).toContainText('Partially Paid');
    await expect(r.locator('button[title="Void Invoice"]')).toHaveCount(0);
    await expect(r.locator('button[title="Record Payment"]')).toBeVisible();
  });

  test('Mock API refuses voiding an invoice with an unreversed receipt', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const inv = (await window.FinanceApi.getInvoices({ status: 'all' })).find((i) => i.invoice_number === 'INV-2026-001');
      await window.FinanceApi.recordInvoicePayment(inv.id, { direction: 'incoming', amount: 100, currency: 'USD', payment_date: '2026-09-10', bank_account_id: 1, reference: 'F1-VOID-1' });
      try { await window.FinanceApi.voidInvoice(inv.id, 'oops'); return 'voided'; } catch (e) { return e.message; }
    });
    expect(msg).toContain('has_unreversed_receipts');
  });

  test('Mock API refuses a receipt into an account of another currency', async ({ page }) => {
    const msg = await page.evaluate(async () => {
      const inv = (await window.FinanceApi.getInvoices({ status: 'all' })).find((i) => i.invoice_number === 'INV-2026-001');
      try { await window.FinanceApi.recordInvoicePayment(inv.id, { direction: 'incoming', amount: 100, currency: 'USD', payment_date: '2026-09-10', bank_account_id: 3, reference: 'F1-CUR-1' }); return 'recorded'; } catch (e) { return e.message; }
    });
    expect(msg).toContain('currency_mismatch');
  });

  test('Editing a sent invoice locks customer, currency, issue date and lines; a draft stays editable', async ({ page }) => {
    await row(page, 'INV-2026-001').locator('button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceModal')).toBeVisible();
    await expect(page.locator('#invoiceCustomerId')).toBeDisabled();
    await expect(page.locator('#invoiceCurrency')).toBeDisabled();
    await expect(page.locator('#invoiceIssueDate')).toBeDisabled();
    await expect(page.locator('#invoiceNumber')).toHaveJSProperty('readOnly', true);
    await expect(page.locator('#invoiceLinesBody tr').first().locator('.inv-price')).toBeDisabled();
    await expect(page.locator('#invoiceDueDate')).toBeEnabled();
    await expect(page.locator('#invoiceNotes')).toBeEnabled();
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();

    await row(page, 'INV-2026-002').locator('button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceModal')).toBeVisible();
    await expect(page.locator('#invoiceCustomerId')).toBeEnabled();
    await expect(page.locator('#invoiceCurrency')).toBeEnabled();
    await expect(page.locator('#invoiceLinesBody tr').first().locator('.inv-price')).toBeEnabled();
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
  });

  test('Mock API refuses a client-supplied status and changes to a sent invoice\'s lines', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const res = {};
      try { await window.FinanceApi.createInvoice({ customer_id: 1, invoice_number: 'F1-S', issue_date: '2026-09-01', due_date: '2026-09-30', status: 'sent', currency: 'USD', lines: [] }); res.create = 'ok'; } catch (e) { res.create = e.message; }
      const inv = (await window.FinanceApi.getInvoices({ status: 'all' })).find((i) => i.invoice_number === 'INV-2026-001');
      try { await window.FinanceApi.updateInvoice(inv.id, { status: 'paid' }); res.update = 'ok'; } catch (e) { res.update = e.message; }
      try { await window.FinanceApi.updateInvoice(inv.id, { lines: [{ description: 'Other', quantity: 1, unit_price: 1, line_total: 1 }] }); res.lines = 'ok'; } catch (e) { res.lines = e.message; }
      return res;
    });
    expect(out.create).toContain('status cannot be set');
    expect(out.update).toContain('status cannot be set');
    expect(out.lines).toContain('invoice_locked');
  });

  test('Approve and issue creates the invoice as a draft and then sends it', async ({ page }) => {
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();
    await page.selectOption('#invoiceCustomerId', { index: 1 });
    await page.fill('#invoiceNumber', 'INV-F1-NEW-001');
    await page.fill('#invoiceDueDate', '2030-01-31');
    const line = page.locator('#invoiceLinesBody tr').first();
    await line.locator("input[type='text']").fill('Service');
    await line.locator('.inv-qty').fill('1');
    await line.locator('.inv-price').fill('250');
    await page.click('#invoiceModalSaveBtn');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    await expect(row(page, 'INV-F1-NEW-001')).toContainText('Sent');
  });
});
