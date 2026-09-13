import { test, expect } from '@playwright/test';

test.describe('Story 0.3 — Accessible Dialog and Form Foundation', () => {

  test('Acceptance Criteria 1: Dialog semantics, initial focus, escape dismissal, and focus restoration', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Invoices & Customers
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await page.click('#tabFinanceCustomers');
    const addCustBtn = page.locator('#financeAddCustomerBtn');
    await expect(addCustBtn).toBeVisible();

    // Focus and click trigger button
    await addCustBtn.focus();
    await addCustBtn.click();

    // Modal overlay and dialog should be visible
    const modalOverlay = page.locator('#customerModal');
    await expect(modalOverlay).toBeVisible();

    const dialog = modalOverlay.locator('.modal');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'customerModalTitle');

    // Title element has accessible name
    const title = page.locator('#customerModalTitle');
    await expect(title).toHaveText(/Add Customer/i);

    // Initial focus must be inside the dialog
    await expect(page.locator('#fCustomerName')).toBeFocused();
    const isFocusInside = await page.evaluate(() => {
      const active = document.activeElement;
      const modal = document.getElementById('customerModal');
      return modal && modal.contains(active);
    });
    expect(isFocusInside).toBe(true);

    // Press Escape to dismiss dialog
    await page.keyboard.press('Escape');
    await expect(modalOverlay).not.toBeVisible();

    // Focus must be restored back to the invoking button
    const isFocusRestored = await page.evaluate(() => {
      return document.activeElement && document.activeElement.id === 'financeAddCustomerBtn';
    });
    expect(isFocusRestored).toBe(true);
  });

  test('Acceptance Criteria 2: Focus trapping inside open dialog (Tab / Shift+Tab cycling)', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Open customer modal
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await page.click('#tabFinanceCustomers');
    await page.click('#financeAddCustomerBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    // Focus last focusable element in modal
    await page.evaluate(() => {
      const modal = document.querySelector('#customerModal .modal');
      const focusables = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      focusables[focusables.length - 1].focus();
    });

    // Press Tab from the last element -> must cycle to the first element
    await page.keyboard.press('Tab');
    const firstFocusedInside = await page.evaluate(() => {
      const modal = document.querySelector('#customerModal .modal');
      const focusables = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      return document.activeElement === focusables[0];
    });
    expect(firstFocusedInside).toBe(true);

    // Press Shift+Tab from the first element -> must cycle back to the last element
    await page.keyboard.press('Shift+Tab');
    const lastFocusedInside = await page.evaluate(() => {
      const modal = document.querySelector('#customerModal .modal');
      const focusables = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      return document.activeElement === focusables[focusables.length - 1];
    });
    expect(lastFocusedInside).toBe(true);

    // Close modal with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#customerModal')).not.toBeVisible();
  });

  test('Acceptance Criteria 3: Form controls have explicit accessible labels, not placeholder alone', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const checkModals = [
      '#customerModal',
      '#vendorModal',
      '#companyBankAccountModal',
      '#billModal',
      '#invoiceModal',
      '#financeTransferModal',
    ];

    for (const modalSelector of checkModals) {
      const missingLabels = await page.evaluate((sel) => {
        const modal = document.querySelector(sel);
        if (!modal) return ['Modal not found: ' + sel];

        const inputs = Array.from(modal.querySelectorAll('input:not([type="hidden"]), select, textarea'));
        const issues = [];

        inputs.forEach((input) => {
          const id = input.id;
          const hasAriaLabel = input.getAttribute('aria-label');
          const hasAriaLabelledby = input.getAttribute('aria-labelledby');
          const explicitLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
          const wrappingLabel = input.closest('label');

          if (!hasAriaLabel && !hasAriaLabelledby && !explicitLabel && !wrappingLabel) {
            issues.push(`Input #${id || input.name || input.type} in ${sel} has no associated label`);
          }
        });

        return issues;
      }, modalSelector);

      expect(missingLabels).toEqual([]);
    }
  });

  test('Acceptance Criteria 4: Form validation error summary banner and inline field errors', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Open customer modal
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await page.click('#tabFinanceCustomers');
    await page.click('#financeAddCustomerBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    // Clear required name and click save
    await page.fill('#fCustomerName', '');
    await page.click('#customerSaveBtn');

    // Accessible error summary banner must appear
    const summary = page.locator('#customerModal .form-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute('role', 'alert');
    await expect(summary).toHaveAttribute('aria-live', 'assertive');

    // Must link to problematic field
    const summaryLink = summary.locator('a[href="#fCustomerName"]');
    await expect(summaryLink).toBeVisible();
    await expect(summaryLink).toContainText(/Customer Name is required/i);

    // Inline field error must be connected via aria-describedby and aria-invalid
    const input = page.locator('#fCustomerName');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveClass(/is-invalid/);
    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toContain('fCustomerName-error');

    const inlineError = page.locator('#fCustomerName-error');
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toHaveAttribute('role', 'alert');

    // Entering text and submitting clears the errors
    await page.fill('#fCustomerName', 'Acme Global Testing Corp');
    await page.click('#customerSaveBtn');

    // Customer should be saved and modal closed
    await expect(page.locator('#customerModal')).not.toBeVisible();
  });

  test('Acceptance Criteria 5: WAI-ARIA tab navigation and keyboard arrow cycling', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Go to Bank & Cash Accounts
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    const subnav = page.locator('#financeAccountsSubNav');
    await expect(subnav).toBeVisible();
    await expect(subnav).toHaveAttribute('role', 'tablist');

    const tabs = subnav.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(4);

    // Initial state: first tab is selected
    const firstTab = tabs.nth(0);
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
    await expect(firstTab).toHaveAttribute('tabindex', '0');

    const secondTab = tabs.nth(1);
    await expect(secondTab).toHaveAttribute('aria-selected', 'false');
    await expect(secondTab).toHaveAttribute('tabindex', '-1');

    // Focus first tab and press ArrowRight
    await firstTab.focus();
    await page.keyboard.press('ArrowRight');

    // Second tab should now have focus, aria-selected="true", and tabindex="0"
    await expect(secondTab).toHaveAttribute('aria-selected', 'true');
    await expect(secondTab).toHaveAttribute('tabindex', '0');
    await expect(firstTab).toHaveAttribute('aria-selected', 'false');
    await expect(firstTab).toHaveAttribute('tabindex', '-1');

    // Press ArrowLeft to cycle back
    await page.keyboard.press('ArrowLeft');
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
    await expect(firstTab).toHaveAttribute('tabindex', '0');
  });

  test('Acceptance Criteria 6: Touch target sizing meets minimum accessibility standards (>= 40px)', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Open a modal to check close button size
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await page.click('#tabFinanceCustomers');
    await page.click('#financeAddCustomerBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    const closeBtn = page.locator('#customerModal .modal-close');
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toHaveAttribute('aria-label', 'Close dialog');

    // Wait for modal transition/scale animation to settle
    await page.waitForTimeout(250);
    const box = await closeBtn.boundingBox();
    expect(box).not.toBeNull();
    // Must be at least 40px x 40px touch target
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(40);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(40);

    await page.keyboard.press('Escape');
    await expect(page.locator('#customerModal')).not.toBeVisible();
  });

});
