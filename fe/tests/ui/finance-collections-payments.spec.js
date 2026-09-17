import { test, expect } from '@playwright/test';

test.describe('Story 3.3 — Collections and Payment Recording', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Sales Invoices
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await expect(page.locator('#financeInvoicesContainer')).toBeVisible();
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Partial payment updates balance and status atomically', async ({ page }) => {
    // Switch to All tab
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    // INV-2026-001 (Total $12,500, Paid $0, Balance $12,500)
    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await expect(row).toBeVisible();

    // Click Pay button
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();

    // Verify modal displays remaining balance
    const infoText = await page.locator('#paymentInvoiceInfo').innerText();
    expect(infoText).toContain('INV-2026-001');
    expect(infoText).toContain('12,500');

    // Enter partial payment: $4,500
    await page.locator('#paymentAmount').clear();
    await page.locator('#paymentAmount').fill('4500.00');
    await page.locator('#paymentReference').fill('WIRE-PARTIAL-001');
    await page.selectOption('#paymentBankAccountId', { index: 1 });

    // Submit payment
    await page.click('#invoicePaymentModal button:has-text("Record Payment")');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();

    // Verify row updated: Paid $4,500, Balance $8,000
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);
    const updatedRow = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    const rowText = await updatedRow.innerText();
    expect(rowText).toContain('4,500.00');
    expect(rowText).toContain('8,000.00');
  });

  test('AC 2: Overpayment is prevented by default', async ({ page }) => {
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    // INV-2026-002 is $8,400. Let's send it first to make it eligible for payment
    const sendBtn = page.locator('#financeInvoicesTableBody tr[data-record-id="2"] button[title="Approve & Send Invoice"]');
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
      await page.waitForTimeout(300);
    }

    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="2"]');
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();

    // Attempt to pay $99,999 (exceeding balance)
    await page.locator('#paymentAmount').fill('99999.00');
    await page.locator('#paymentReference').fill('OVERPAY-ATTEMPT');
    await page.selectOption('#paymentBankAccountId', { index: 1 });

    await page.click('#invoicePaymentModal button:has-text("Record Payment")');

    // Error message should appear and modal should stay open
    await expect(page.locator('#invoicePaymentModal .field-error-msg')).toBeVisible();
    const errorText = await page.locator('#invoicePaymentModal .field-error-msg').innerText();
    expect(errorText).toContain('cannot exceed remaining balance');

    await page.click('#invoicePaymentModal .modal-close');
  });

  test('AC 3: Duplicate payment references trigger review', async ({ page }) => {
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    // 1. First payment with reference DUP-REF-999
    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();

    await page.locator('#paymentAmount').fill('100.00');
    await page.locator('#paymentReference').fill('DUP-REF-999');
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.click('#invoicePaymentModal button:has-text("Record Payment")');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();

    // 2. Second payment reusing DUP-REF-999
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();

    await page.locator('#paymentAmount').fill('100.00');
    await page.locator('#paymentReference').fill('DUP-REF-999');
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.click('#invoicePaymentModal button:has-text("Record Payment")');

    // Should show error notification about duplicate reference in #toastWrap
    await expect(page.locator('#toastWrap')).toContainText('Duplicate payment reference');
    await page.click('#invoicePaymentModal .modal-close');
  });

  test('AC 4: Reminder actions explain missing email and dispatch to valid recipient', async ({ page }) => {
    // 1. Create invoice for customer without email directly
    const noEmailCustomer = await page.evaluate(async () => {
      return await window.FinanceApi.createCustomer({
        name: 'No Email Corp',
        contact_email: '',
      });
    });

    await page.evaluate(async (custId) => {
      await window.FinanceApi.createInvoice({
        customer_id: custId,
        invoice_number: 'INV-NO-EMAIL-001',
        issue_date: '2026-09-01',
        due_date: '2026-09-05',
        status: 'sent',
        currency: 'USD',
        lines: [{ description: 'Testing Service', quantity: 1, unit_price: 500 }],
      });
      await window.loadFinanceInvoices();
    }, noEmailCustomer.id);

    // Look for the invoice row
    await page.click('#tabQueueAll');
    await page.waitForTimeout(300);
    const noEmailRow = page.locator('#financeInvoicesTableBody tr:has-text("INV-NO-EMAIL-001")');
    await expect(noEmailRow).toBeVisible();
    const remindBtn = noEmailRow.locator('button[title="Send Reminder"]');
    await expect(remindBtn).toBeVisible();
    await remindBtn.click();

    // Confirmation dialog should explain that the customer has no email on file
    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    const dialogText = await page.locator('#financeConfirmModal').innerText();
    expect(dialogText).toContain('no contact email address on file');
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#financeConfirmModal')).not.toBeVisible();

    // 2. Reminder for customer WITH email (INV-2026-003 is overdue and has email in mock)
    const emailRow = page.locator('#financeInvoicesTableBody tr[data-record-id="3"]');
    await emailRow.locator('button[title="Send Reminder"]').click();

    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    const emailDialogText = await page.locator('#financeConfirmModal').innerText();
    expect(emailDialogText).toContain('Recipient:');
    // Confirm sending
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#toastWrap')).toContainText('successfully');
  });

  test('AC 5: Payment reversal restores invoice balance and status', async ({ page }) => {
    // Pay full balance of invoice 1
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await row.locator('button[title="Record Payment"]').click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();

    await page.locator('#paymentAmount').fill('12500.00');
    await page.locator('#paymentReference').fill('FULL-PAY-REV-TEST');
    await page.selectOption('#paymentBankAccountId', { index: 1 });
    await page.click('#invoicePaymentModal button:has-text("Record Payment")');
    await expect(page.locator('#invoicePaymentModal')).not.toBeVisible();

    // Now reverse the payment via API
    await page.evaluate(async () => {
      const payments = await window.FinanceApi.getInvoicePayments(1);
      const target = payments.find((p) => p.reference === 'FULL-PAY-REV-TEST');
      if (target) {
        await window.FinanceApi.reverseInvoicePayment(1, target.id, 'Test reversal');
        await window.loadFinanceInvoices();
      }
    });

    await page.waitForTimeout(300);
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    // Balance should be restored to $12,500 and status should NOT be Paid
    const restoredRow = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    const rowText = await restoredRow.innerText();
    expect(rowText).toContain('12,500.00');
    expect(rowText).not.toContain('Paid');
  });
});
