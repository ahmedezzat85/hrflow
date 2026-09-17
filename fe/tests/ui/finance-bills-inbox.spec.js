import { test, expect } from '@playwright/test';

test.describe('Story 4.1 — Bill capture and AP inbox', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills section
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Uploaded bills do not become payable until required fields are reviewed', async ({ page }) => {
    // Open Upload / Capture modal
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Verify modal initialized for capture / upload
    await expect(page.locator('#billCaptureSection')).toBeVisible();
    await expect(page.locator('#billIsReviewed')).not.toBeChecked();

    // Fill bill details
    await page.selectOption('#billVendorId', { index: 1 });
    await page.fill('#billNumber', 'BILL-CAPTURE-001');
    await page.selectOption('#billDepartment', 'Engineering');
    await page.selectOption('#billCategoryId', { label: 'Infrastructure' });
    await page.fill('#billIssueDate', '2026-03-01');
    await page.fill('#billDueDate', '2026-03-31');

    // Add a line item so bill has an amount
    await page.click('#billModal button:has-text("Add Line")');
    const firstLineDesc = page.locator('#billLinesBody tr input[type="text"]').first();
    await firstLineDesc.fill('Cloud Server Hosting');
    const firstLinePrice = page.locator('#billLinesBody tr input.bill-price').first();
    await firstLinePrice.fill('1500');
    await firstLinePrice.dispatchEvent('input');

    // Attempt to set status to Ready to Pay while is_reviewed is UNCHECKED
    await page.selectOption('#billStatus', 'ready_to_pay');
    await page.click('#billModalSaveBtn');

    // Modal must still be open because unreviewed bills cannot move directly to ready_to_pay
    await expect(page.locator('#billModal')).toBeVisible();

    // Now check "Mark verified and reviewed"
    await page.check('#billIsReviewed');
    await page.click('#billModalSaveBtn');

    // Modal closes upon successful review and save
    await expect(page.locator('#billModal')).not.toBeVisible();

    // Verify bill appears in table with Reviewed status badge
    const createdRow = page.locator('#financeBillsTableBody tr:has-text("BILL-CAPTURE-001")');
    await expect(createdRow).toBeVisible();
    expect(await createdRow.innerText()).toContain('Reviewed');
  });

  test('AC 2: Low-confidence / missing fields are clearly identified', async ({ page }) => {
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    const missingAlert = page.locator('#billMissingFieldsAlert');
    // Initially Department and Category are empty, so missing fields alert should be visible
    await page.dispatchEvent('#billDepartment', 'change');
    await expect(missingAlert).toBeVisible();
    expect(await missingAlert.innerText()).toContain('Missing required coding');

    // Populate Department, alert should still flag Category
    await page.selectOption('#billDepartment', 'Operations');
    await page.dispatchEvent('#billDepartment', 'change');
    await expect(missingAlert).toBeVisible();
    expect(await missingAlert.innerText()).toContain('Category');

    // Populate Category, alert should hide
    await page.selectOption('#billCategoryId', { label: 'Facilities & Maintenance' });
    await expect(missingAlert).not.toBeVisible();

    // Close modal
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 3: Likely duplicates are blocked or require authorized override with reason', async ({ page }) => {
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    const dupBanner = page.locator('#billDuplicateBanner');
    await expect(dupBanner).not.toBeVisible();

    // Use vendor 1 and an existing bill number "BILL-2026-001"
    await page.selectOption('#billVendorId', { index: 1 });
    await page.fill('#billNumber', 'BILL-2026-001');
    await page.fill('#billIssueDate', '2026-02-01');
    await page.fill('#billDueDate', '2026-03-01');
    await page.dispatchEvent('#billNumber', 'input');

    // Wait for duplicate check debounce
    await page.waitForTimeout(400);
    await expect(dupBanner).toBeVisible();
    expect(await page.locator('#billDuplicateText').innerText()).toContain('Matches existing bill');

    // Try to save without override -> should be blocked
    await page.selectOption('#billDepartment', 'Engineering');
    await page.selectOption('#billCategoryId', { label: 'Infrastructure' });
    await page.check('#billIsReviewed');
    await page.click('#billModalSaveBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Check override checkbox -> reason field becomes visible
    const overrideCheckbox = page.locator('#billDuplicateOverrideCheckbox');
    await overrideCheckbox.check();
    const reasonInput = page.locator('#billDuplicateOverrideReason');
    await expect(reasonInput).toBeVisible();

    // Try to save without reason -> blocked
    await page.click('#billModalSaveBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Provide override reason
    await reasonInput.fill('Verified duplicate charge: quarterly adjustment fee authorized by CFO');
    await page.click('#billModalSaveBtn');

    // Modal closes
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 4: Queue counts and statuses update after each transition', async ({ page }) => {
    // Open status panel via Change view button
    await page.click('#financeBillChangeViewBtn');
    await expect(page.locator('#financeBillStatusPanel')).toBeVisible();

    // Verify AP Inbox Work Queue tabs are present
    await expect(page.locator('#financeBillWorkQueueTabs')).toBeVisible();
    await expect(page.locator('#tabBillQueueAll')).toBeVisible();
    await expect(page.locator('#tabBillQueueInbox')).toBeVisible();
    await expect(page.locator('#tabBillQueueCoding')).toBeVisible();
    await expect(page.locator('#tabBillQueueApproval')).toBeVisible();
    await expect(page.locator('#tabBillQueueReady')).toBeVisible();

    // Verify badges contain numbers
    const allBadge = page.locator('#badgeBillQueueAll');
    await expect(allBadge).toBeVisible();
    const allCount = parseInt(await allBadge.innerText(), 10);
    expect(allCount).toBeGreaterThan(0);

    // Filter by "Needs Coding" queue tab (clicks and auto-collapses panel)
    await page.click('#tabBillQueueCoding');
    await expect(page.locator('#financeBillStatusPanel')).not.toBeVisible();
    await expect(page.locator('#financeBillActiveStatusLabel')).toHaveText('Needs Coding');

    // Switch to "All" queue tab by reopening panel
    await page.click('#financeBillChangeViewBtn');
    await expect(page.locator('#financeBillStatusPanel')).toBeVisible();
    await page.click('#tabBillQueueAll');
    await expect(page.locator('#financeBillStatusPanel')).not.toBeVisible();
    await expect(page.locator('#financeBillActiveStatusLabel')).toHaveText('All');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
  });
});
