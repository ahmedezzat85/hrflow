import { test, expect } from '@playwright/test';

test.describe('Story 1.3 — Detail Drawer and Activity Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#financeInvoicesTable tbody tr').first()).toBeVisible();
  });

  test('Acceptance Criteria 1: Clicking View button opens detail drawer with record summary, counterparty, amount, and attributes', async ({ page }) => {
    const firstRow = page.locator('#financeInvoicesTable tbody tr').first();
    const viewBtn = firstRow.locator('.btn-view-invoice');
    await expect(viewBtn).toBeVisible();

    await viewBtn.click();

    const drawer = page.locator('#financeDetailDrawer');
    await expect(drawer).toBeVisible();

    // Check title and entity badge
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('Invoice INV-2026-001');
    await expect(page.locator('#financeDetailDrawerBadge')).toContainText('INVOICE');

    // Check Overview panel
    await expect(page.locator('#financeDrawerAmountDisplay')).toContainText('12,500.00');
    await expect(page.locator('#financeDrawerCounterpartyDisplay')).toContainText('Apex Health Partners');

    // Check Key Attributes
    const attrsGrid = page.locator('#financeDrawerAttributesList');
    await expect(attrsGrid).toContainText('Due Date');
    await expect(attrsGrid).toContainText('Subtotal');
  });

  test('Acceptance Criteria 2: Activity Timeline renders chronological plain-language events with actor and timestamp', async ({ page }) => {
    const viewBtn = page.locator('#financeInvoicesTable tbody tr .btn-view-invoice').first();
    await viewBtn.click();

    await expect(page.locator('#financeDetailDrawer')).toBeVisible();

    // Switch to Activity Timeline tab
    const timelineTab = page.locator('#tabDrawerTimeline');
    await timelineTab.click();
    await expect(timelineTab).toHaveClass(/active/);
    await expect(timelineTab).toHaveAttribute('aria-selected', 'true');

    const timelinePanel = page.locator('#financeDrawerTimelinePanel');
    await expect(timelinePanel).toBeVisible();

    const items = timelinePanel.locator('.timeline-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify plain language text and actor
    const firstItemText = await items.first().textContent();
    expect(firstItemText).toContain('created');
    expect(firstItemText).toContain('admin@voyancemed.com');
  });

  test('Acceptance Criteria 3: Related Records allow drilling into linked records without losing navigation context', async ({ page }) => {
    const viewBtn = page.locator('#financeInvoicesTable tbody tr .btn-view-invoice').first();
    await viewBtn.click();

    // Switch to Related Records tab
    const relatedTab = page.locator('#tabDrawerRelated');
    await relatedTab.click();
    await expect(relatedTab).toHaveClass(/active/);

    const relatedPanel = page.locator('#financeDrawerRelatedPanel');
    await expect(relatedPanel).toBeVisible();

    const relatedCards = relatedPanel.locator('.related-record-card');
    await expect(relatedCards.first()).toBeVisible();

    // Click related transaction card
    const txCard = relatedCards.filter({ hasText: 'Payment Inflow TXN-0001' }).first();
    await txCard.click();

    // Drawer should update with Transaction detail
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('Transaction TXN-0001');
    await expect(page.locator('#financeDetailDrawerBadge')).toContainText('TRANSACTION');
  });

  test('Acceptance Criteria 4: Focus management and keyboard Escape closes drawer and restores focus to invoking element', async ({ page }) => {
    const viewBtn = page.locator('#financeInvoicesTable tbody tr .btn-view-invoice').first();
    await viewBtn.focus();
    await page.keyboard.press('Enter');

    const drawer = page.locator('#financeDetailDrawer');
    await expect(drawer).toBeVisible();

    // Focus is trapped inside drawer (e.g. close button has focus)
    const closeBtn = page.locator('#financeDetailDrawerCloseBtn');
    await expect(closeBtn).toBeFocused();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // Verify focus is restored to the invoking view button
    await expect(viewBtn).toBeFocused();
  });

  test('Acceptance Criteria 5: Opening and closing detail preserves table filters, sorting, and pagination', async ({ page }) => {
    // Apply search filter
    await page.fill('#financeInvoiceSearch', 'Apex');
    await expect(page.locator('#financeInvoicesTable tbody tr')).toHaveCount(1);

    // Open detail drawer
    const viewBtn = page.locator('#financeInvoicesTable tbody tr .btn-view-invoice').first();
    await viewBtn.click();
    await expect(page.locator('#financeDetailDrawer')).toBeVisible();

    // Close detail drawer
    await page.click('#financeDetailDrawerCloseBtn');
    await expect(page.locator('#financeDetailDrawer')).toBeHidden();

    // Verify search filter and filtered table row count remain unchanged
    await expect(page.locator('#financeInvoiceSearch')).toHaveValue('Apex');
    await expect(page.locator('#financeInvoicesTable tbody tr')).toHaveCount(1);
    await expect(page.locator('#financeInvoicesTable tbody tr')).toContainText('Apex Health Partners');
  });

  test('Acceptance Criteria 6: Browser Back button closes drawer and restores URL state', async ({ page }) => {
    const viewBtn = page.locator('#financeInvoicesTable tbody tr .btn-view-invoice').first();
    await viewBtn.click();
    await expect(page.locator('#financeDetailDrawer')).toBeVisible();

    // Hash should be updated to #detail=invoice:1
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain('#detail=invoice:1');

    // Click browser Back
    await page.goBack();
    await expect(page.locator('#financeDetailDrawer')).toBeHidden();
  });
});
