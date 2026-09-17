import { test, expect } from '@playwright/test';

test.describe('FUX-414 — Collapsible Bills status tab bar into status pill + panel', () => {
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

  test('AC 1: On page load, status panel is collapsed; only toggle bar is visible with active pill and count', async ({ page }) => {
    // Status toggle bar is visible
    const toggleBar = page.locator('#financeBillStatusToggleBar');
    await expect(toggleBar).toBeVisible();

    // Status tabs panel is collapsed by default
    const statusPanel = page.locator('#financeBillStatusPanel');
    await expect(statusPanel).not.toBeVisible();

    // Active pill displays "All" and non-zero count
    const activePill = page.locator('#financeBillActiveStatusPill');
    await expect(activePill).toBeVisible();
    await expect(page.locator('#financeBillActiveStatusLabel')).toHaveText('All');
    const activeCount = parseInt(await page.locator('#financeBillActiveStatusCount').innerText(), 10);
    expect(activeCount).toBeGreaterThan(0);

    // Result count shows "Showing X of Y bills"
    const resultCount = page.locator('#financeBillViewResultCount');
    await expect(resultCount).toBeVisible();
    await expect(resultCount).toContainText(`Showing ${activeCount} of ${activeCount} bills`);

    // "Change view" button is present with correct ARIA attributes
    const changeViewBtn = page.locator('#financeBillChangeViewBtn');
    await expect(changeViewBtn).toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(changeViewBtn).toHaveAttribute('aria-controls', 'financeBillStatusPanel');
  });

  test('AC 2: Clicking "Change view" reveals status tabs panel, and clicking again collapses it without changing view', async ({ page }) => {
    const changeViewBtn = page.locator('#financeBillChangeViewBtn');
    const statusPanel = page.locator('#financeBillStatusPanel');

    // Initially collapsed
    await expect(statusPanel).not.toBeVisible();

    // Click "Change view" to expand
    await changeViewBtn.click();
    await expect(statusPanel).toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'true');

    // All status queue tabs are visible inside the panel
    await expect(page.locator('#tabBillQueueAll')).toBeVisible();
    await expect(page.locator('#tabBillQueueInbox')).toBeVisible();
    await expect(page.locator('#tabBillQueueCoding')).toBeVisible();
    await expect(page.locator('#tabBillQueueApproval')).toBeVisible();
    await expect(page.locator('#tabBillQueueReady')).toBeVisible();
    await expect(page.locator('#tabBillQueueScheduled')).toBeVisible();
    await expect(page.locator('#tabBillQueuePaid')).toBeVisible();
    await expect(page.locator('#tabBillQueueExceptions')).toBeVisible();

    // "All" tab is currently active
    await expect(page.locator('#tabBillQueueAll')).toHaveClass(/active/);

    // Click "Change view" again to collapse
    await changeViewBtn.click();
    await expect(statusPanel).not.toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'false');

    // Selection unchanged: active pill still says "All"
    await expect(page.locator('#financeBillActiveStatusLabel')).toHaveText('All');
  });

  test('AC 3: Selecting a different status tab switches view, updates pill and count, and auto-collapses panel', async ({ page }) => {
    const changeViewBtn = page.locator('#financeBillChangeViewBtn');
    const statusPanel = page.locator('#financeBillStatusPanel');

    // 1. Expand panel
    await changeViewBtn.click();
    await expect(statusPanel).toBeVisible();

    // Read count from Needs Approval tab badge
    const approvalBadge = page.locator('#badgeBillQueueApproval');
    const expectedApprovalCount = await approvalBadge.innerText();

    // 2. Click "Needs Approval" tab
    await page.click('#tabBillQueueApproval');

    // 3. Verify panel auto-collapses automatically after tab click
    await expect(statusPanel).not.toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'false');

    // 4. Verify toggle bar pill updates immediately to "Needs Approval" and its count
    await expect(page.locator('#financeBillActiveStatusLabel')).toHaveText('Needs Approval');
    await expect(page.locator('#financeBillActiveStatusCount')).toHaveText(expectedApprovalCount);

    // 5. Verify result count updates to reflect current view
    await expect(page.locator('#financeBillViewResultCount')).toContainText(`Showing ${expectedApprovalCount} of`);

    // 6. Verify table rows reflect Needs Approval queue
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")');
    await expect(billRow).toBeVisible();
  });

  test('AC 4: Keyboard accessibility — Change view operates via Enter and Space with ARIA state', async ({ page }) => {
    const changeViewBtn = page.locator('#financeBillChangeViewBtn');
    const statusPanel = page.locator('#financeBillStatusPanel');

    await changeViewBtn.focus();
    await expect(changeViewBtn).toBeFocused();

    // Activate with Enter key
    await page.keyboard.press('Enter');
    await expect(statusPanel).toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'true');

    // Close with Space key
    await page.keyboard.press('Space');
    await expect(statusPanel).not.toBeVisible();
    await expect(changeViewBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('AC 5: Status panel and FUX-412 secondary filter panel operate independently', async ({ page }) => {
    const statusPanel = page.locator('#financeBillStatusPanel');
    const filterPanel = page.locator('#financeBillFilterPanel');
    const changeViewBtn = page.locator('#financeBillChangeViewBtn');
    const filterToggleBtn = page.locator('#financeBillFilterToggleBtn');

    // Both start collapsed
    await expect(statusPanel).not.toBeVisible();
    await expect(filterPanel).not.toBeVisible();

    // Open FUX-412 filter panel
    await filterToggleBtn.click();
    await expect(filterPanel).toBeVisible();
    await expect(statusPanel).not.toBeVisible(); // Status panel must remain collapsed

    // Open Status panel
    await changeViewBtn.click();
    await expect(statusPanel).toBeVisible();
    await expect(filterPanel).toBeVisible(); // Both can be open simultaneously

    // Close status panel
    await changeViewBtn.click();
    await expect(statusPanel).not.toBeVisible();
    await expect(filterPanel).toBeVisible(); // Filter panel stays open
  });
});
