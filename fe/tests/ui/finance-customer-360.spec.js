import { test, expect } from '@playwright/test';

test.describe('Story 3.4 — Customer 360 profile and duplicate detection', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Sales Invoices
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await expect(page.locator('#financeInvoicesContainer')).toBeVisible();

    // Switch to Customers sub-tab
    await page.click('#tabFinanceCustomers');
    await expect(page.locator('#financeCustomersContainer')).toBeVisible();
    await expect(page.locator('#financeCustomersTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Customer identity & required fields are captured and validated', async ({ page }) => {
    // Open Add Customer Modal
    await page.click('#financeAddCustomerBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    // Submit empty form -> should be blocked by required validation
    await page.click('#customerSaveBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    // Fill valid new customer details
    await page.fill('#fCustomerName', 'Zenith Radiology Systems');
    await page.fill('#fCustomerLegalName', 'Zenith Radiology Systems Global Inc');
    await page.fill('#fCustomerEmail', 'finance@zenithrad.com');
    await page.fill('#fCustomerPhone', '+1 555-8822');
    await page.fill('#fCustomerTaxId', 'US-99112233');
    await page.fill('#fCustomerTerms', '45');
    await page.selectOption('#fCustomerCurrency', 'USD');
    await page.fill('#fCustomerCountry', 'United States');
    await page.fill('#fCustomerOwner', 'John Billing');
    await page.fill('#fCustomerAddress', '450 Innovation Way, Suite 800');
    await page.fill('#fCustomerNotes', 'Tier-1 enterprise customer');

    // Save customer
    await page.click('#customerSaveBtn');
    await expect(page.locator('#customerModal')).not.toBeVisible();

    // Verify row appeared in customers table
    const row = page.locator('#financeCustomersTableBody tr:has-text("Zenith Radiology Systems")');
    await expect(row).toBeVisible();
    const rowText = await row.innerText();
    expect(rowText).toContain('Zenith Radiology Systems');
    expect(rowText).toContain('Zenith Radiology Systems Global Inc');
    expect(rowText).toContain('finance@zenithrad.com');
    expect(rowText).toContain('Net 45');
    expect(rowText).toContain('US-99112233');
  });

  test('AC 2: Duplicate candidates detected and alerted before creation', async ({ page }) => {
    await page.click('#financeAddCustomerBtn');
    await expect(page.locator('#customerModal')).toBeVisible();

    const banner = page.locator('#customerDuplicateBanner');
    await expect(banner).not.toBeVisible();

    // Type a name matching existing customer "Apex Health Partners" (case & corporate suffix tolerant)
    await page.fill('#fCustomerName', 'Apex Health Partners Inc');
    await page.waitForTimeout(400); // Allow debounce
    await expect(banner).toBeVisible();
    const alertText = await page.locator('#customerDuplicateText').innerText();
    expect(alertText).toContain('Apex Health Partners');

    // Clear name, alert disappears
    await page.fill('#fCustomerName', '');
    await page.waitForTimeout(400);
    await expect(banner).not.toBeVisible();

    // Test duplicate on tax ID
    await page.fill('#fCustomerTaxId', 'US-88992211');
    await page.waitForTimeout(400);
    await expect(banner).toBeVisible();

    // Close modal
    await page.click('#customerModal .modal-close');
    await expect(page.locator('#customerModal')).not.toBeVisible();
  });

  test('AC 3: Customer totals drill down to composing invoices in 360 detail drawer', async ({ page }) => {
    // Open Customer 360 for Apex Health Partners (Customer ID 1)
    const apexRow = page.locator('#financeCustomersTableBody tr:has-text("Apex Health Partners")');
    await expect(apexRow).toBeVisible();

    // Click on customer name link or 360 button
    await apexRow.locator('a.table-entity-link').click();

    // Detail drawer overlay should be visible
    const drawerOverlay = page.locator('#financeDetailDrawerOverlay');
    await expect(drawerOverlay).toBeVisible();

    // Verify drawer header
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('Apex Health Partners');
    await expect(page.locator('#financeDetailDrawerBadge')).toContainText('CUSTOMER');

    // Verify 360 Overview / Attributes
    const attrsText = (await page.locator('#financeDrawerAttributesList').innerText()).toUpperCase();
    expect(attrsText).toContain('TOTAL INVOICED');
    expect(attrsText).toContain('OUTSTANDING BALANCE');
    expect(attrsText).toContain('PAYMENT TERMS');

    // Switch to Related Records tab to verify composing invoices
    await page.click('#financeDrawerTablist button[data-drawer-tab="related"]');
    await expect(page.locator('#financeDrawerRelatedPanel')).toBeVisible();

    const relatedCards = page.locator('#financeDrawerRelatedList .related-record-card');
    await expect(relatedCards.first()).toBeVisible();
    const firstCardText = await relatedCards.first().innerText();
    expect(firstCardText).toContain('INV-2026-001');

    // Clicking composing invoice navigates detail drawer directly to that invoice
    await relatedCards.first().click();
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('INV-2026-001');
    await expect(page.locator('#financeDetailDrawerBadge')).toContainText('INVOICE');

    // Close drawer
    await page.click('#financeDetailDrawerCloseBtn');
    await expect(drawerOverlay).not.toBeVisible();
  });

  test('AC 4: Inactive customers remain on history but cannot be selected for new invoices by default', async ({ page }) => {
    // Locate BioCare Diagnostics (Customer ID 2)
    const row = page.locator('#financeCustomersTableBody tr:has-text("BioCare Diagnostics")');
    await expect(row).toBeVisible();

    // Click deactivate button
    await row.locator('button[title="Deactivate"]').click();

    // Confirm dialog appears
    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#financeConfirmModal')).not.toBeVisible();

    // Verify status badge changed to Inactive
    await expect(row.locator('.status-badge-wrap')).toContainText(/Inactive/i);

    // Switch to Invoices tab and open Add Invoice Modal
    await page.click('#tabFinanceInvoices');
    await expect(page.locator('#financeInvoicesContainer')).toBeVisible();
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    // Check customer dropdown options
    const options = await page.locator('#invoiceCustomerId option').allInnerTexts();
    // Inactive customer "BioCare Diagnostics" must NOT be selectable for new invoices
    expect(options).not.toContain('BioCare Diagnostics');
    expect(options).toContain('Apex Health Partners');

    // Close invoice modal
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
  });
});
