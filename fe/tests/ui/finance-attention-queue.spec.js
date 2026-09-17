import { test, expect } from '@playwright/test';

test.describe('Story 2.2 — Finance Needs-Attention Queue', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Finance Overview
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();
    await expect(page.locator('#financeAttentionQueueCard')).toBeVisible();
    await expect(page.locator('.finance-attention-row').first()).toBeVisible({ timeout: 10000 });
  });

  test('Acceptance Criteria 1: Queue displays actionable items with counts, explicit text, and icons (not color alone)', async ({ page }) => {
    const queueCard = page.locator('#financeAttentionQueueCard');
    await expect(queueCard).toBeVisible();

    // Check count badges
    const totalBadge = page.locator('#badgeAttentionTotalCount');
    await expect(totalBadge).toBeVisible();
    await expect(totalBadge).toContainText('items');

    const urgentBadge = page.locator('#badgeAttentionUrgentCount');
    await expect(urgentBadge).toBeVisible();
    await expect(urgentBadge).toContainText('Urgent');

    // Check attention row structure
    const rows = page.locator('.finance-attention-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    const firstRow = rows.first();
    // Severity badge with visible text & icon
    const sevBadge = firstRow.locator('.badge');
    await expect(sevBadge.first()).toBeVisible();
    const sevText = await sevBadge.first().textContent();
    expect(['Urgent', 'Warning', 'Info'].some((s) => sevText.includes(s))).toBeTruthy();

    // Due state chip with visible text & icon
    const dueChip = firstRow.locator('.due-chip');
    await expect(dueChip).toBeVisible();
    const dueText = await dueChip.textContent();
    expect(dueText.trim().length).toBeGreaterThan(0);

    // Resolve and Reviewed action buttons
    await expect(firstRow.locator('.btn-attention-resolve')).toBeVisible();
    await expect(firstRow.locator('.btn-attention-review')).toBeVisible();
  });

  test('Acceptance Criteria 2: Severity and category filters update the queue consistently', async ({ page }) => {
    // Filter to Urgent only
    await page.selectOption('#filterAttentionSeverity', 'urgent');
    await page.waitForTimeout(300);

    const rows = page.locator('.finance-attention-row');
    const urgentCount = await rows.count();
    expect(urgentCount).toBeGreaterThan(0);

    for (let i = 0; i < urgentCount; i++) {
      const row = rows.nth(i);
      await expect(row).toHaveAttribute('data-severity', 'urgent');
    }

    // Filter to Overdue Invoices category
    await page.selectOption('#filterAttentionSeverity', 'all');
    await page.selectOption('#filterAttentionType', 'overdue_receivable');
    await page.waitForTimeout(300);

    const invRows = page.locator('.finance-attention-row');
    const invCount = await invRows.count();
    expect(invCount).toBeGreaterThan(0);

    for (let i = 0; i < invCount; i++) {
      const row = invRows.nth(i);
      await expect(row).toHaveAttribute('data-type', 'overdue_receivable');
    }
  });

  test('Acceptance Criteria 3: Keyword search filters queue exceptions', async ({ page }) => {
    const searchInput = page.locator('#inputAttentionSearch');
    await searchInput.fill('Amazon');
    await page.waitForTimeout(400); // debounce timer

    const rows = page.locator('.finance-attention-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    const text = await rows.first().textContent();
    expect(text).toContain('Amazon');
  });

  test('Acceptance Criteria 4: Marking an item reviewed updates UI and decrements counts', async ({ page }) => {
    const initialTotalText = await page.locator('#badgeAttentionTotalCount').textContent();
    const initialTotal = parseInt(initialTotalText, 10);

    const firstRow = page.locator('.finance-attention-row').first();
    const itemKey = await firstRow.getAttribute('data-key');
    expect(itemKey).toBeTruthy();

    // Click Reviewed button
    await firstRow.locator('.btn-attention-review').click();

    // Verify toast confirmation
    await expect(page.locator('#toastWrap .toast').last()).toContainText('Item marked as reviewed');

    // Verify item is removed from queue
    await expect(page.locator(`.finance-attention-row[data-key="${itemKey}"]`)).toHaveCount(0);

    const newTotalText = await page.locator('#badgeAttentionTotalCount').textContent();
    const newTotal = parseInt(newTotalText, 10);
    expect(newTotal).toBe(initialTotal - 1);
  });

  test('Acceptance Criteria 5: Resolve button deep-links to the target domain section', async ({ page }) => {
    // Reset filters
    await page.selectOption('#filterAttentionSeverity', 'all');
    await page.selectOption('#filterAttentionType', 'all');
    await page.locator('#inputAttentionSearch').fill('');
    await page.waitForTimeout(300);

    // Find an invoice row
    const invoiceRow = page.locator('.finance-attention-row[data-type="overdue_receivable"]').first();
    await expect(invoiceRow).toBeVisible();

    // Click Resolve
    await invoiceRow.locator('.btn-attention-resolve').click();

    // Verifies navigation to Invoices section
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
  });
});
