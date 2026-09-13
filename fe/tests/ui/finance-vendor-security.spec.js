import { test, expect } from '@playwright/test';

test.describe('Story 4.3 — Vendor profile and payment-data security', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    // Switch to Vendors sub-tab
    await page.click('#tabFinanceVendors');
    await expect(page.locator('#financeVendorsContainer')).toBeVisible();
    await expect(page.locator('#financeVendorsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Payment instructions masked by default in vendor detail / modal', async ({ page }) => {
    // Open edit modal for Amazon Web Services (Vendor ID 1)
    const awsRow = page.locator('#financeVendorsTableBody tr:has-text("Amazon Web Services")');
    await expect(awsRow).toBeVisible();

    // Click edit button
    await awsRow.locator('button[title="Edit Vendor"]').click();
    await expect(page.locator('#vendorModal')).toBeVisible();

    // Verify Payment Instructions list is loaded
    const piList = page.locator('#vendorPaymentInstructionsList');
    await expect(piList).toBeVisible();
    const piText = await piList.innerText();

    // Sensitive bank account must be masked (ending with 4821)
    expect(piText).toContain('******4821');
    expect(piText).not.toContain('98765432104821');
    expect(piText).toContain('VERIFIED');

    // Close modal
    await page.click('#vendorModal .modal-close');
    await expect(page.locator('#vendorModal')).not.toBeVisible();
  });

  test('AC 2: Payment instruction change sets unverified and allows verification', async ({ page }) => {
    // Open edit modal for Slack Technologies (Vendor ID 2)
    const slackRow = page.locator('#financeVendorsTableBody tr:has-text("Slack Technologies")');
    await expect(slackRow).toBeVisible();
    await slackRow.locator('button[title="Edit Vendor"]').click();
    await expect(page.locator('#vendorModal')).toBeVisible();

    // Check existing instruction is UNVERIFIED
    const piList = page.locator('#vendorPaymentInstructionsList');
    await expect(piList).toContainText('UNVERIFIED');

    // Click Verify Instruction button
    const verifyBtn = piList.locator('button:has-text("Verify Instruction")');
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    // Verify status updates to VERIFIED
    await expect(piList).toContainText('VERIFIED');

    // Close modal
    await page.click('#vendorModal .modal-close');
    await expect(page.locator('#vendorModal')).not.toBeVisible();
  });

  test('AC 3: Inactive vendors remain on history but are excluded from new bills by default', async ({ page }) => {
    // Locate Slack Technologies (Vendor ID 2)
    const slackRow = page.locator('#financeVendorsTableBody tr:has-text("Slack Technologies")');
    await expect(slackRow).toBeVisible();

    // Deactivate Slack Technologies
    await slackRow.locator('button[title="Deactivate"]').click();
    await expect(page.locator('#financeConfirmModal')).toBeVisible();
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#financeConfirmModal')).not.toBeVisible();

    // Verify vendor row status is now Inactive
    await expect(slackRow.locator('.status-badge-wrap')).toContainText(/Inactive/i);

    // Switch to Bills sub-tab
    await page.click('#tabFinanceBills');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();

    // Historical bills for Slack Technologies still show vendor name
    const histBill = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")');
    await expect(histBill).toBeVisible();
    expect(await histBill.innerText()).toContain('Slack Technologies');

    // Open Record Bill Modal
    await page.click('#financeRecordBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Verify dropdown does NOT include deactivated vendor
    const vendorOptions = await page.locator('#billVendorId option').allInnerTexts();
    expect(vendorOptions).not.toContain('Slack Technologies');
    expect(vendorOptions).toContain('Amazon Web Services');

    // Close bill modal
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 4: Duplicate candidate check alerts before vendor creation', async ({ page }) => {
    await page.click('#financeAddVendorBtn');
    await expect(page.locator('#vendorModal')).toBeVisible();

    const banner = page.locator('#vendorDuplicateBanner');
    await expect(banner).not.toBeVisible();

    // Type name matching existing "Amazon Web Services Inc"
    await page.fill('#fVendorName', 'Amazon Web Services LLC');
    await page.waitForTimeout(400); // Allow debounce
    await expect(banner).toBeVisible();
    const alertText = await page.locator('#vendorDuplicateText').innerText();
    expect(alertText).toContain('Amazon Web Services');

    // Clear name, alert vanishes
    await page.fill('#fVendorName', '');
    await page.waitForTimeout(400);
    await expect(banner).not.toBeVisible();

    // Test duplicate on tax ID
    await page.fill('#fVendorTaxId', 'VAT-1294819');
    await page.waitForTimeout(400);
    await expect(banner).toBeVisible();

    // Close modal
    await page.click('#vendorModal .modal-close');
    await expect(page.locator('#vendorModal')).not.toBeVisible();
  });

  test('AC 5: Vendor 360 detail drawer shows spend metrics and composing bills', async ({ page }) => {
    // Open 360 for Amazon Web Services (Vendor ID 1)
    const awsRow = page.locator('#financeVendorsTableBody tr:has-text("Amazon Web Services")');
    await expect(awsRow).toBeVisible();

    // Click 360 link / button
    await awsRow.locator('button[title="View 360 & Payments"]').click();

    // Verify drawer overlay opened
    const drawerOverlay = page.locator('#financeDetailDrawerOverlay');
    await expect(drawerOverlay).toBeVisible();
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('Amazon Web Services');
    await expect(page.locator('#financeDetailDrawerBadge')).toContainText('VENDOR');

    // Check 360 overview attributes
    const attrsText = (await page.locator('#financeDrawerAttributesList').innerText()).toUpperCase();
    expect(attrsText).toContain('TOTAL SPEND');
    expect(attrsText).toContain('OPEN BILLS COUNT');
    expect(attrsText).toContain('PAYMENT INSTRUCTIONS');

    // Switch to Related tab to see composing bills
    await page.click('#financeDrawerTablist button[data-drawer-tab="related"]');
    await expect(page.locator('#financeDrawerRelatedPanel')).toBeVisible();
    const relatedCards = page.locator('#financeDrawerRelatedList .related-record-card');
    await expect(relatedCards.first()).toBeVisible();
    expect(await relatedCards.first().innerText()).toContain('BILL-2026-001');

    // Close drawer
    await page.click('#financeDetailDrawerCloseBtn');
    await expect(drawerOverlay).not.toBeVisible();
  });
});
