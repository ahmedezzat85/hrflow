import { test, expect } from '@playwright/test';

test.describe('FUX-412 — Collapsible bill list filters', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any previous stored preference for bill filters
    await page.goto('/?mock=admin');
    await page.evaluate(() => {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('hrflow_bill_filters_expanded')) {
          localStorage.removeItem(key);
        }
      });
    });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('AC 1: Filters are collapsed by default on first visit and toolbar occupies a single compact row', async ({ page }) => {
    // Navigate to Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    // Free-text search is always visible in toolbar
    const searchInput = page.locator('#financeBillSearch');
    await expect(searchInput).toBeVisible();

    // Filters toggle button is visible adjacent to search box
    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(toggleBtn).toHaveAttribute('aria-controls', 'financeBillFilterPanel');

    // Badge is hidden (no filters applied)
    const badge = page.locator('#financeBillFilterBadge');
    await expect(badge).toBeHidden();

    // Filter panel is collapsed by default
    const filterPanel = page.locator('#financeBillFilterPanel');
    await expect(filterPanel).toBeHidden();

    // Secondary filter dropdowns are hidden inside the collapsed panel
    await expect(page.locator('#financeBillStatusFilter')).toBeHidden();
    await expect(page.locator('#financeBillAttachmentFilter')).toBeHidden();
  });

  test('AC 2: Clicking toggle expands/collapses panel without resetting list state or reload', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    const filterPanel = page.locator('#financeBillFilterPanel');

    // Initial state: collapsed
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(filterPanel).toBeHidden();

    // Expand
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(filterPanel).toBeVisible();
    await expect(page.locator('#financeBillStatusFilter')).toBeVisible();
    await expect(page.locator('#financeBillAttachmentFilter')).toBeVisible();

    // Check that bill table rows remain intact
    const rowCount = await page.locator('#financeBillsTableBody tr').count();
    expect(rowCount).toBeGreaterThan(0);

    // Collapse again
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(filterPanel).toBeHidden();
    // Rows still intact
    await expect(page.locator('#financeBillsTableBody tr')).toHaveCount(rowCount);
  });

  test('AC 3: Active-filter count badge reflects non-default filters even while collapsed', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    const badge = page.locator('#financeBillFilterBadge');
    const filterPanel = page.locator('#financeBillFilterPanel');

    // 1. Expand panel
    await toggleBtn.click();
    await expect(filterPanel).toBeVisible();

    // 2. Select Status: Paid (1 filter) -> matches BILL-2026-002
    await page.selectOption('#financeBillStatusFilter', 'paid');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    // 3. Select Attachment: No Attachment (2 filters) -> BILL-2026-002 has no attachment
    await page.selectOption('#financeBillAttachmentFilter', 'no_attachment');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');

    // 4. Collapse the panel
    await toggleBtn.click();
    await expect(filterPanel).toBeHidden();

    // 5. Badge remains visible showing "2" even while panel is collapsed
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
    await expect(badge).toHaveAttribute('aria-label', '2 filters applied');

    // List is filtered (only paid bills without attachment: BILL-2026-002)
    const filteredRows = page.locator('#financeBillsTableBody tr');
    const count = await filteredRows.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toBeVisible();

    // 6. Expand panel and click Reset button
    await toggleBtn.click();
    await expect(filterPanel).toBeVisible();
    await page.click('#financeBillResetFiltersBtn');

    // Badge disappears after reset
    await expect(badge).toBeHidden();
    await expect(page.locator('#financeBillStatusFilter')).toHaveValue('');
    await expect(page.locator('#financeBillAttachmentFilter')).toHaveValue('');
  });

  test('AC 4: Filter preference persists in localStorage across page reloads', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    const filterPanel = page.locator('#financeBillFilterPanel');

    // Expand panel
    await toggleBtn.click();
    await expect(filterPanel).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    // Set a filter so we can test both persistence of expanded state and filter value
    await page.selectOption('#financeBillStatusFilter', 'paid');
    await expect(page.locator('#financeBillFilterBadge')).toHaveText('1');

    // Reload page
    await page.reload();
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    // Panel should still be expanded and badge should reflect active filter
    await expect(page.locator('#financeBillFilterPanel')).toBeVisible();
    await expect(page.locator('#financeBillFilterToggleBtn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#financeBillFilterBadge')).toBeVisible();
    await expect(page.locator('#financeBillFilterBadge')).toHaveText('1');
  });

  test('AC 5: Deep links / pre-applied filters auto-expand the filter panel on load', async ({ page }) => {
    // 1. Navigate with query param: attachment=with_attachment
    await page.goto('/?mock=admin&attachment=with_attachment');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    // Filter panel should be automatically expanded because incoming filter is non-default
    const filterPanel = page.locator('#financeBillFilterPanel');
    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    await expect(filterPanel).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#financeBillAttachmentFilter')).toHaveValue('with_attachment');

    // Badge reflects the active filter
    const badge = page.locator('#financeBillFilterBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');

    // 2. Test deep link navigation via openAttentionItem carrying filter
    await page.evaluate(() => {
      window.openAttentionItem('a-finance-bills', 2, encodeURIComponent(JSON.stringify({ status: 'paid' })));
    });
    await expect(filterPanel).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#financeBillStatusFilter')).toHaveValue('paid');
  });

  test('AC 6: Keyboard accessibility - toggle operates via Enter and Space with ARIA attributes', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    const filterPanel = page.locator('#financeBillFilterPanel');

    // Focus the toggle button
    await toggleBtn.focus();
    await expect(toggleBtn).toBeFocused();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(filterPanel).toBeHidden();

    // Press Enter to expand
    await page.keyboard.press('Enter');
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(filterPanel).toBeVisible();

    // Press Space to collapse
    await page.keyboard.press('Space');
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(filterPanel).toBeHidden();
  });
});
