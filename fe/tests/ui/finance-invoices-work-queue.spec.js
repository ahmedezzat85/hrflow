import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Story 3.1 — Invoice Work Queue and Detail', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Sales Invoices
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await expect(page.locator('#financeInvoicesContainer')).toBeVisible();
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  // D-027 (doc 21 section 6.2): the Open / Awaiting payment / Overdue tabs and the status select are gone.
  // One pill row (All, Draft, Sent, Partially paid, Paid, Void) plus an "Overdue only" toggle; the default is All.
  test('Acceptance Criteria 1: Default view is All and the old tabs and status select are gone', async ({ page }) => {
    const allTab = page.locator('#tabQueueAll');
    await expect(allTab).toHaveClass(/active/);
    await expect(allTab).toHaveAttribute('aria-selected', 'true');
    for (const gone of ['#tabQueueOpen', '#tabQueueAwaitingPayment', '#tabQueueOverdue', '#financeInvoiceStatusFilter', '#financeInvoiceFilterChips']) {
      await expect(page.locator(gone)).toHaveCount(0);
    }
    const tableText = await page.locator('#financeInvoicesTableBody').innerText();
    for (const n of ['001', '002', '003', '004', '005', '006']) expect(tableText).toContain(`INV-2026-${n}`);
    await expect(page.locator('#badgeQueueAll')).toHaveText('6');
  });

  test('Acceptance Criteria 2: Status pills and the overdue toggle filter correctly across states', async ({ page }) => {
    // 1. Draft
    await page.click('#tabQueueDraft');
    let tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-002');
    expect(tableText).not.toContain('INV-2026-001');
    expect(tableText).not.toContain('INV-2026-005');

    // 2. Sent, then Overdue only narrows it to the late invoice and shows its late note
    await page.click('#tabQueueSent');
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-001');
    expect(tableText).toContain('INV-2026-003');
    await page.locator('#financeInvoiceOverdueOnly').check();
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-003');
    expect(tableText).toContain('days late');
    expect(tableText).not.toContain('INV-2026-001');
    await page.locator('#financeInvoiceOverdueOnly').uncheck();

    // 3. Partially paid
    await page.click('#tabQueuePartiallyPaid');
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-004');
    expect(tableText).not.toContain('INV-2026-001');

    // 4. Paid
    await page.click('#tabQueuePaid');
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-005');
    expect(tableText).not.toContain('INV-2026-001');

    // 5. Void
    await page.click('#tabQueueVoid');
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-006');
    expect(tableText).not.toContain('INV-2026-001');

    // 6. All
    await page.click('#tabQueueAll');
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-001');
    expect(tableText).toContain('INV-2026-005');
    expect(tableText).toContain('INV-2026-006');
  });

  test('Acceptance Criteria 3: Outstanding balance displays total minus non-reversed payments', async ({ page }) => {
    await page.click('#tabQueueAll');

    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="4"]');
    await expect(row).toBeVisible();

    // Total: $11,000, Paid: $4,000, Balance: $7,000 (the Balance cell shows "of total"; the paid share is its progress bar)
    const rowText = await row.innerText();
    expect(rowText).toContain('11,000');
    expect(rowText).toContain('7,000');
    expect(await row.locator('.fv-progress__fill').getAttribute('style')).toContain('36.');
  });

  test('Acceptance Criteria 4: Detail drawer opens with record balance, attributes, and next action', async ({ page }) => {
    // Open detail drawer for INV-2026-001
    const viewBtn = page.locator('#financeInvoicesTableBody tr[data-record-id="1"] .btn-view-invoice');
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();

    // Check drawer overlay & content
    const overlay = page.locator('#financeDetailDrawerOverlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    const title = page.locator('#financeDetailDrawerTitle');
    await expect(title).toContainText('INV-2026-001');

    // Verify Summary Attributes include Subtotal, Amount Paid, Outstanding Balance, and Next Action
    const attrsList = page.locator('#financeDrawerAttributesList');
    await expect(attrsList).toBeVisible();
    const attrsText = (await attrsList.innerText()).toUpperCase();
    expect(attrsText).toContain('SUBTOTAL');
    expect(attrsText).toContain('AMOUNT PAID');
    expect(attrsText).toContain('OUTSTANDING BALANCE');
    expect(attrsText).toContain('NEXT ACTION');

    // Close drawer with close button
    await page.click('#financeDetailDrawerCloseBtn');
    await expect(overlay).not.toBeVisible();
  });
});
