import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Bills redesign: the status row is five queues (Needs attention, Overdue, To pay, Paid, All) plus a Status menu
// for the exact status and a Type menu. It supersedes the nine-tab row of D-021 / FUX-414.
const QUEUES = ['Attention', 'Overdue', 'ToPay', 'Paid', 'All'];

test.describe('Bills queue row (Bills redesign, supersedes D-021 nine tabs)', () => {
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

  test('AC 1: five queues with counts open on Needs attention; Status and Type menus sit beside them', async ({ page }) => {
    await expect(page.locator('#financeBillStatusRow')).toBeVisible();
    await expect(page.locator('#financeBillWorkQueueTabs')).toHaveAttribute('role', 'tablist');
    for (const id of QUEUES) {
      await expect(page.locator(`#tabBillQueue${id}`)).toBeVisible();
      await expect(page.locator(`#tabBillQueue${id}`)).toHaveAttribute('role', 'tab');
      await expect(page.locator(`#badgeBillQueue${id}`)).toBeVisible();
    }
    await expect(page.locator('#tabBillQueueAttention')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabBillQueueAttention')).toHaveClass(/active/);
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'false');

    const attention = parseInt(await page.locator('#badgeBillQueueAttention').innerText(), 10);
    expect(attention).toBeGreaterThan(0);
    await expect(page.locator('#financeBillsPagination .pagination-summary')).toContainText(`of ${attention}`);
    await expect(page.locator('#financeBillStatusFilter')).toBeVisible();
    await expect(page.locator('#financeBillKindFilter')).toBeVisible();
    await expect(page.locator('#financeBillGroupToggle')).toBeVisible();
    // the nine-tab row and the Overdue only switch are gone
    for (const gone of ['#tabBillQueueDraft', '#tabBillQueuePendingApproval', '#tabBillQueueVoid', '#financeBillOverdueOnly']) {
      await expect(page.locator(gone)).toHaveCount(0);
    }
    // Direction A: no icons on in-page tabs
    await expect(page.locator('#financeBillWorkQueueTabs i')).toHaveCount(0);
  });

  test('AC 2: Needs attention holds drafts, pending, rejected and overdue bills, and nothing that is settled', async ({ page }) => {
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toBeVisible(); // draft
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")')).toBeVisible(); // pending approval
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-006")')).toBeVisible(); // rejected
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible(); // approved and overdue
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toHaveCount(0); // paid
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-007")')).toHaveCount(0); // scheduled, not late
  });

  test('AC 3: Choosing a queue filters the table and updates aria-selected and the result count', async ({ page }) => {
    const toPay = await page.locator('#badgeBillQueueToPay').innerText();
    await page.click('#tabBillQueueToPay');
    await expect(page.locator('#tabBillQueueToPay')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tabBillQueueToPay')).toHaveClass(/active/);
    await expect(page.locator('#tabBillQueueAttention')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#financeBillsPagination .pagination-summary')).toContainText(`of ${toPay}`);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-007")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toHaveCount(0);

    await page.click('#tabBillQueueAll');
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toBeVisible();
    // All leaves out Void, matching its count
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-008")')).toHaveCount(0);
  });

  test('AC 4: The Status menu picks an exact status; no queue pill is active while it is set', async ({ page }) => {
    await page.selectOption('#financeBillStatusFilter', 'pending_approval');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toHaveCount(0);
    for (const id of QUEUES) await expect(page.locator(`#tabBillQueue${id}`)).toHaveAttribute('aria-selected', 'false');
    await page.selectOption('#financeBillStatusFilter', 'void');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-008")')).toBeVisible();
    await page.selectOption('#financeBillStatusFilter', '');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toBeVisible();
    await expect(page.locator('#tabBillQueueAll')).toHaveAttribute('aria-selected', 'true');
  });

  test('AC 5: Status pills are coloured, not white, and the selected pill has a ring', async ({ page }) => {
    const bg = (id) => page.locator(id).evaluate((el) => getComputedStyle(el).backgroundColor);
    const paid = await bg('#tabBillQueuePaid');
    const overdue = await bg('#tabBillQueueOverdue');
    const toPay = await bg('#tabBillQueueToPay');
    expect(new Set([paid, overdue, toPay]).size).toBe(3);
    for (const c of [paid, overdue, toPay]) expect(c).not.toBe('rgb(255, 255, 255)');
    await page.click('#tabBillQueuePaid');
    expect(await page.locator('#tabBillQueuePaid').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    expect(await page.locator('#tabBillQueueAll').evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  });

  test('AC 6: Keyboard, queues are focusable buttons that activate with Enter and Space', async ({ page }) => {
    const overdue = page.locator('#tabBillQueueOverdue');
    await overdue.focus();
    await expect(overdue).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(overdue).toHaveAttribute('aria-selected', 'true');

    const paid = page.locator('#tabBillQueuePaid');
    await paid.focus();
    await page.keyboard.press('Space');
    await expect(paid).toHaveAttribute('aria-selected', 'true');
    await expect(overdue).toHaveAttribute('aria-selected', 'false');
  });

  for (const width of [1100, 1300, 1440]) {
    test(`AC 7: Row wraps cleanly at ${width}px (no horizontal overflow, every queue inside the viewport)`, async ({ page }) => {
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

  test('AC 8: No Filters button or panel exists; queues, the two menus and search are the only filters', async ({ page }) => {
    for (const gone of ['#financeBillFilterToggleBtn', '#financeBillFilterPanel', '#financeBillAttachmentFilter']) {
      await expect(page.locator(gone)).toHaveCount(0);
    }
    await page.click('#tabBillQueueAll');
    await page.fill('#financeBillSearch', 'slack');
    await expect(page.locator('#financeBillsTableBody tr')).not.toHaveCount(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("Amazon")')).toHaveCount(0);
  });
});
