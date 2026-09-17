import { test, expect } from '@playwright/test';

test.describe('Story 3.2 — Guided Invoice Editor and Lifecycle', () => {
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

  test('AC 1: Status dropdown only allows Draft or Sent (Creator cannot manually choose Paid or Overdue)', async ({ page }) => {
    // Open New Sales Invoice modal
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    const statusOptions = await page.locator('#invoiceStatus option').allTextContents();
    const statusValues = await page.$$eval('#invoiceStatus option', (opts) => opts.map((o) => o.value));

    // Creator cannot choose Paid, Overdue, or Void directly
    expect(statusValues).toContain('draft');
    expect(statusValues).toContain('sent');
    expect(statusValues).not.toContain('paid');
    expect(statusValues).not.toContain('overdue');
    expect(statusValues).not.toContain('void');

    // Close modal
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
  });

  test('AC 2: Line-item calculations update dynamically to match server calculation', async ({ page }) => {
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Fill first line item
    const lineRow = page.locator('#invoiceLinesBody tr').first();
    await lineRow.locator("input[type='text']").fill('Consulting Service');
    await lineRow.locator('.inv-qty').fill('4');
    await lineRow.locator('.inv-price').fill('250.00');

    // Verify line total auto-computes 4 * 250 = 1000.00
    await expect(lineRow.locator('.inv-total')).toHaveValue('1000.00');
    await expect(page.locator('#invoiceSubtotalDisplay')).toHaveText('1000.00');
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('1000.00');

    // Add another line item
    await page.click('#invoiceModal button:has-text("Add Line")');
    const secondRow = page.locator('#invoiceLinesBody tr').nth(1);
    await secondRow.locator("input[type='text']").fill('Cloud Setup');
    await secondRow.locator('.inv-qty').fill('2');
    await secondRow.locator('.inv-price').fill('500.00');

    await expect(secondRow.locator('.inv-total')).toHaveValue('1000.00');
    await expect(page.locator('#invoiceSubtotalDisplay')).toHaveText('2000.00');
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('2000.00');

    await page.click('#invoiceModal .modal-close');
  });

  test('AC 3: Draft auto-saves to storage and can be resumed or discarded', async ({ page }) => {
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Input draft data
    await page.locator('#invoiceNumber').fill('INV-DRAFT-AUTOSAVE');
    await page.locator('#invoiceNotes').fill('Auto saved draft notes');
    const lineRow = page.locator('#invoiceLinesBody tr').first();
    await lineRow.locator("input[type='text']").fill('Retainer Package');
    await lineRow.locator('.inv-qty').fill('3');
    await lineRow.locator('.inv-price').fill('300.00');

    // Trigger storage event
    await page.locator('#invoiceNotes').evaluate((el) => el.dispatchEvent(new Event('input', { bubbles: true })));

    // Verify localStorage has saved the draft
    const rawDraft = await page.evaluate(() => localStorage.getItem('hrflow_invoice_draft'));
    expect(rawDraft).toBeTruthy();
    const parsed = JSON.parse(rawDraft);
    expect(parsed.invoiceNumber).toBe('INV-DRAFT-AUTOSAVE');
    expect(parsed.notes).toBe('Auto saved draft notes');

    // Close and reopen modal
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();

    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Resume banner should now be visible
    const banner = page.locator('#invoiceDraftResumeBanner');
    await expect(banner).toBeVisible();

    // Click Resume
    await banner.locator('button:has-text("Resume")').click();
    await expect(banner).not.toBeVisible();

    // Form fields should be restored
    await expect(page.locator('#invoiceNumber')).toHaveValue('INV-DRAFT-AUTOSAVE');
    await expect(page.locator('#invoiceNotes')).toHaveValue('Auto saved draft notes');
    await expect(page.locator('#invoiceTotalDisplay')).toHaveText('900.00');

    // Close modal and discard
    await page.click('#invoiceModal .modal-close');
    await page.click('#financeNewInvoiceBtn');
    await expect(banner).toBeVisible();
    await banner.locator('button:has-text("Discard")').click();
    await expect(banner).not.toBeVisible();

    const clearedDraft = await page.evaluate(() => localStorage.getItem('hrflow_invoice_draft'));
    expect(clearedDraft).toBeNull();
    await page.click('#invoiceModal .modal-close');
  });

  test('AC 4: Issued invoices lock invoice numbering against modification', async ({ page }) => {
    // Switch to All tab so we see all invoices
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    // Edit an issued invoice (INV-2026-001 is sent)
    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="1"]');
    await row.locator('button[title="Edit Invoice"]').click();
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Invoice number field should be readonly
    const invNum = page.locator('#invoiceNumber');
    await expect(invNum).toHaveAttribute('readonly', '');
    const lockNote = page.locator('#invoiceNumberImmutableNote');
    await expect(lockNote).toBeVisible();

    await page.click('#invoiceModal .modal-close');

    // In contrast, opening New Invoice should NOT have readonly invoice number
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceNumber')).not.toHaveAttribute('readonly', '');
    await expect(page.locator('#invoiceNumberImmutableNote')).not.toBeVisible();
    await page.click('#invoiceModal .modal-close');
  });

  test('AC 5: Guided lifecycle buttons and send action create/transition invoice states', async ({ page }) => {
    // 1. Save Draft action
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Select customer
    await page.selectOption('#invoiceCustomerId', { index: 1 });
    await page.locator('#invoiceNumber').fill('INV-GUIDED-001');
    await page.locator('#invoiceIssueDate').fill('2026-09-01');
    await page.locator('#invoiceDueDate').fill('2026-09-30');
    const lineRow = page.locator('#invoiceLinesBody tr').first();
    await lineRow.locator("input[type='text']").fill('Draft service');
    await lineRow.locator('.inv-qty').fill('1');
    await lineRow.locator('.inv-price').fill('1500.00');

    // Click Save Draft
    await page.click('#invoiceSaveDraftBtn');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();

    // Should appear in Drafts queue
    await page.click('#tabQueueDraft');
    await page.waitForTimeout(200);
    let tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-GUIDED-001');

    // 2. Direct Send action transitions Draft to Sent
    const draftRow = page.locator('#financeInvoicesTableBody tr:has-text("INV-GUIDED-001")');
    const sendBtn = draftRow.locator('button[title="Approve & Send Invoice"]');
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();
    await page.waitForTimeout(300);

    // It should now disappear from Draft queue
    await page.click('#tabQueueDraft');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).not.toContain('INV-GUIDED-001');

    // And appear in Awaiting Payment queue
    await page.click('#tabQueueAwaitingPayment');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-GUIDED-001');
  });
});
