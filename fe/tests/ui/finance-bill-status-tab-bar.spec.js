import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Direction A (D-021) supersedes FUX-414: the status tabs are an always-visible row.
// There is no active-status pill, "Change view" button or hidden panel any more.
const TAB_IDS = ['All', 'Draft', 'PendingApproval', 'Rejected', 'Approved', 'Scheduled', 'PartiallyPaid', 'Paid', 'Void'];

test.describe('Bills status row (D-021, supersedes FUX-414)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: All nine status tabs, counts, result count and Overdue only are visible on load; no hidden panel remains', async ({ page }) => {
    await expect(page.locator('#financeBillStatusRow')).toBeVisible();
    await expect(page.locator('#financeBillWorkQueueTabs')).toHaveAttribute('role', 'tablist');
    for (const id of TAB_IDS) {
      await expect(page.locator(`#tabBillQueue${id}`)).toBeVisible();
      await expect(page.locator(`#tabBillQueue${id}`)).toHaveAttribute('role', 'tab');
      await expect(page.locator(`#badgeBillQueue${id}`)).toBeVisible();
    }
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabBillQueueAll')).toHaveClass(/active/);

    const allCount = parseInt(await page.locator('#badgeBillQueueAll').innerText(), 10);
    expect(allCount).toBeGreaterThan(0);
    // D-027: the duplicate count above the table is gone; the footer count (pagination summary) is the only one.
    await expect(page.locator('#financeBillViewResultCount')).toHaveCount(0);
    await expect(page.locator('#financeBillsPagination .pagination-summary')).toContainText(`Showing 1–${allCount} of ${allCount}`);
    await expect(page.locator('#financeBillOverdueOnly')).toBeVisible();

    for (const gone of ['#financeBillStatusToggleBar', '#financeBillActiveStatusPill', '#financeBillChangeViewBtn', '#financeBillStatusPanel']) {
      await expect(page.locator(gone)).toHaveCount(0);
    }
    // Direction A: no icons on in-page tabs
    await expect(page.locator('#financeBillWorkQueueTabs i')).toHaveCount(0);
  });

  test('AC 2: Selecting a status tab filters the table, keeps the row visible and updates aria-selected and result count', async ({ page }) => {
    const expectedApprovalCount = await page.locator('#badgeBillQueuePendingApproval').innerText();

    await page.click('#tabBillQueuePendingApproval');

    await expect(page.locator('#financeBillStatusRow')).toBeVisible();
    await expect(page.locator('#tabBillQueuePendingApproval')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabBillQueuePendingApproval')).toHaveClass(/active/);
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#financeBillsPagination .pagination-summary')).toContainText(`of ${expectedApprovalCount}`);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toHaveCount(0);

    await page.click('#tabBillQueueAll');
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
  });

  test('AC 2b: Status tags are coloured, not white, and the selected tag has a ring', async ({ page }) => {
    const bg = (id) => page.locator(id).evaluate((el) => getComputedStyle(el).backgroundColor);
    const paid = await bg('#tabBillQueuePaid');
    const rejected = await bg('#tabBillQueueRejected');
    const approved = await bg('#tabBillQueueApproved');
    expect(new Set([paid, rejected, approved]).size).toBe(3);
    for (const c of [paid, rejected, approved]) expect(c).not.toBe('rgb(255, 255, 255)');
    await page.click('#tabBillQueuePaid');
    expect(await page.locator('#tabBillQueuePaid').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    expect(await page.locator('#tabBillQueueAll').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  });

  test('AC 3: Overdue only narrows the list and the control stays in the row', async ({ page }) => {
    const overdueCount = parseInt(await page.locator('#financeBillOverdueCount').innerText(), 10);
    expect(overdueCount).toBeGreaterThan(0);
    await page.locator('#financeBillOverdueOnly').check();
    await expect(page.locator('#financeBillsTableBody tr')).toHaveCount(overdueCount);
    await page.locator('#financeBillOverdueOnly').uncheck();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
  });

  test('AC 4: Keyboard, tabs are focusable buttons that activate with Enter and Space', async ({ page }) => {
    const draft = page.locator('#tabBillQueueDraft');
    await draft.focus();
    await expect(draft).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(draft).toHaveAttribute('aria-selected', 'true');

    const paid = page.locator('#tabBillQueuePaid');
    await paid.focus();
    await page.keyboard.press('Space');
    await expect(paid).toHaveAttribute('aria-selected', 'true');
    await expect(draft).toHaveAttribute('aria-selected', 'false');
  });

  for (const width of [1100, 1300, 1440]) {
    test(`AC 5: Row wraps cleanly at ${width}px (no horizontal overflow, every tab inside the viewport)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('#financeBillStatusRow')).toBeVisible();
      const m = await page.evaluate(() => {
        const row = document.getElementById('financeBillStatusRow').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('#financeBillWorkQueueTabs .filter-tab')].map((t) => t.getBoundingClientRect());
        return {
          rowRight: row.right,
          maxRight: Math.max(...tabs.map((t) => t.right)),
          minLeft: Math.min(...tabs.map((t) => t.left)),
          docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          vw: window.innerWidth,
        };
      });
      expect(m.docOverflow).toBe(false);
      expect(m.maxRight).toBeLessThanOrEqual(m.rowRight + 1);
      expect(m.maxRight).toBeLessThanOrEqual(m.vw);
      expect(m.minLeft).toBeGreaterThanOrEqual(0);
    });
  }

  test('AC 6: No Filters button or panel exists; the tags and search are the only filters', async ({ page }) => {
    for (const gone of ['#financeBillFilterToggleBtn', '#financeBillFilterPanel', '#financeBillStatusFilter', '#financeBillAttachmentFilter']) {
      await expect(page.locator(gone)).toHaveCount(0);
    }
    await page.fill('#financeBillSearch', 'slack');
    await expect(page.locator('#financeBillsTableBody tr')).not.toHaveCount(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("Amazon")')).toHaveCount(0);
  });
});
