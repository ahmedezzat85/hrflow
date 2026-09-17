import { test, expect } from '@playwright/test';

test.describe('Story 3.1 — Invoice Work Queue and Detail', () => {
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

  test('Acceptance Criteria 1: Default Open view excludes Paid and Void records', async ({ page }) => {
    // Open tab should be active by default
    const openTab = page.locator('#tabQueueOpen');
    await expect(openTab).toHaveClass(/active/);
    await expect(openTab).toHaveAttribute('aria-selected', 'true');

    // Status filter select should reflect "open"
    const statusSelect = page.locator('#financeInvoiceStatusFilter');
    await expect(statusSelect).toHaveValue('open');

    // Invoices table rows should contain Open invoices (INV-2026-001, 002, 003, 004)
    const tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-001');
    expect(tableText).toContain('INV-2026-002');
    expect(tableText).toContain('INV-2026-003');
    expect(tableText).toContain('INV-2026-004');

    // Should NOT contain Paid (INV-2026-005) or Void (INV-2026-006)
    expect(tableText).not.toContain('INV-2026-005');
    expect(tableText).not.toContain('INV-2026-006');
  });

  test('Acceptance Criteria 2: Work queue tabs filter correctly across states', async ({ page }) => {
    // 1. Draft queue
    await page.click('#tabQueueDraft');
    await page.waitForTimeout(200);
    let tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-002');
    expect(tableText).not.toContain('INV-2026-001');
    expect(tableText).not.toContain('INV-2026-005');

    // 2. Overdue queue
    await page.click('#tabQueueOverdue');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-003');
    expect(tableText).toContain('overdue');
    expect(tableText).not.toContain('INV-2026-001');

    // 3. Paid queue
    await page.click('#tabQueuePaid');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-005');
    expect(tableText).not.toContain('INV-2026-001');

    // 4. Void queue
    await page.click('#tabQueueVoid');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-006');
    expect(tableText).not.toContain('INV-2026-001');

    // 5. All queue
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);
    tableText = await page.locator('#financeInvoicesTableBody').innerText();
    expect(tableText).toContain('INV-2026-001');
    expect(tableText).toContain('INV-2026-005');
    expect(tableText).toContain('INV-2026-006');
  });

  test('Acceptance Criteria 3: Outstanding balance displays total minus non-reversed payments', async ({ page }) => {
    // Switch to All to see partial payment invoice INV-2026-004
    await page.click('#tabQueueAll');
    await page.waitForTimeout(200);

    const row = page.locator('#financeInvoicesTableBody tr[data-record-id="4"]');
    await expect(row).toBeVisible();

    // Total: $11,000, Paid: $4,000, Balance: $7,000
    const rowText = await row.innerText();
    expect(rowText).toContain('11,000');
    expect(rowText).toContain('4,000');
    expect(rowText).toContain('7,000');
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
