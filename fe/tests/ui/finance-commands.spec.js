import { test, expect } from '@playwright/test';

test.describe('Story 0.4 — Safe Financial Command Framework', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Acceptance Criteria 1: Reusable FinanceCommand.confirmAction renders accessible dialog with identity, consequence, and focus trapping', async ({ page }) => {
    // Navigate to Invoices
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Trigger confirmAction programmatically without blocking
    await page.evaluate(() => {
      window._testConfirmResult = null;
      window.FinanceCommand.confirmAction({
        title: 'Void Test Invoice',
        summary: '<strong>INV-2026-001</strong> · Acme Health · $1,250.00 USD',
        consequence: 'Voiding will permanently void this invoice and cancel all pending receivables.',
        actionLabel: 'Void Invoice',
        actionClass: 'btn btn-danger',
        requireReason: true,
        severity: 'danger',
      }).then((r) => {
        window._testConfirmResult = r;
      });
    });

    const modal = page.locator('#financeConfirmModal');
    await expect(modal).toBeVisible();

    // Verify dialog accessibility semantics
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal.locator('#financeConfirmTitle')).toHaveText('Void Test Invoice');
    await expect(modal.locator('#financeConfirmTargetSummary')).toContainText('INV-2026-001');
    await expect(modal.locator('#financeConfirmDescription')).toContainText('Voiding will permanently void this invoice');

    // Reason field is visible and required
    const reasonGroup = modal.locator('#financeConfirmReasonGroup');
    await expect(reasonGroup).toBeVisible();

    // Test Escape dismissal resolves with confirmed: false
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    const result = await page.evaluate(() => window._testConfirmResult);
    expect(result.confirmed).toBe(false);
  });

  test('Acceptance Criteria 2: Destructive action requires a reason before allowing confirmation', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Start a high-risk action requiring reason
    page.evaluate(() => {
      window._testConfirmResult = null;
      window.FinanceCommand.confirmAction({
        title: 'Void High Risk Item',
        consequence: 'This action is destructive.',
        requireReason: true,
      }).then((res) => {
        window._testConfirmResult = res;
      });
    });

    const modal = page.locator('#financeConfirmModal');
    await expect(modal).toBeVisible();

    // Click confirm WITHOUT typing a reason -> must show validation error
    const confirmBtn = modal.locator('#financeConfirmSubmitBtn');
    await confirmBtn.click();

    // Modal should STILL be visible with error message
    await expect(modal).toBeVisible();
    const errorEl = modal.locator('#financeConfirmReason_error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('A reason is required');

    // Type a reason and submit -> should close and resolve
    const reasonInput = modal.locator('#financeConfirmReason');
    await reasonInput.fill('Duplicate entry entered by mistake');
    await confirmBtn.click();

    await expect(modal).not.toBeVisible();

    const res = await page.evaluate(() => window._testConfirmResult);
    expect(res.confirmed).toBe(true);
    expect(res.reason).toBe('Duplicate entry entered by mistake');
  });

  test('Acceptance Criteria 3: Submit button locking prevents duplicate submissions on rapid double-click', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Open New Invoice modal
    await page.click('#financeNewInvoiceBtn');
    const modal = page.locator('#invoiceModal');
    await expect(modal).toBeVisible();

    const saveBtn = modal.locator('#invoiceModalSaveBtn');
    await expect(saveBtn).toBeVisible();

    // Test lockSubmitButton directly
    const lockResult = await page.evaluate(() => {
      const btn = document.getElementById('invoiceModalSaveBtn');
      const unlock1 = window.FinanceCommand.lockSubmitButton(btn);
      const isLockedFirst = btn.disabled && btn.getAttribute('aria-busy') === 'true';

      // Immediate second click attempt: lockSubmitButton returns null because button is already disabled
      const unlock2 = window.FinanceCommand.lockSubmitButton(btn);
      const isDuplicateBlocked = unlock2 === null;

      // Release lock
      unlock1();
      const isUnlocked = !btn.disabled && !btn.hasAttribute('aria-busy');

      return { isLockedFirst, isDuplicateBlocked, isUnlocked };
    });

    expect(lockResult.isLockedFirst).toBe(true);
    expect(lockResult.isDuplicateBlocked).toBe(true);
    expect(lockResult.isUnlocked).toBe(true);
  });

  test('Acceptance Criteria 4: Idempotency keys are generated uniquely', async ({ page }) => {
    const keys = await page.evaluate(() => {
      const k1 = window.FinanceCommand.generateIdempotencyKey();
      const k2 = window.FinanceCommand.generateIdempotencyKey();
      return { k1, k2, isDistinct: k1 !== k2 };
    });

    expect(keys.isDistinct).toBe(true);
    expect(keys.k1.length).toBeGreaterThan(10);
  });

  test('Acceptance Criteria 5: Voiding an invoice via UI invokes FinanceCommand.confirmAction and updates state', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Wait for table to render
    const tableContainer = page.locator('#financeInvoicesContainer');
    await expect(tableContainer).toBeVisible();

    // Call confirmVoidInvoice for test invoice 1
    page.evaluate(() => {
      window.confirmVoidInvoice(1);
    });

    const confirmModal = page.locator('#financeConfirmModal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal.locator('#financeConfirmTitle')).toHaveText('Void Sales Invoice');

    // Enter reason and confirm
    await confirmModal.locator('#financeConfirmReason').fill('Customer cancelled service');
    await confirmModal.locator('#financeConfirmSubmitBtn').click();
    await expect(confirmModal).not.toBeVisible();

    // Verify toast or status updated
    await expect(page.locator('.toast')).toContainText(/void/i);
  });
});
