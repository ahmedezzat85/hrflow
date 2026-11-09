import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Bills redesign (docs/finance-module/bills-page-redesign-plan.md): shared header with a book switch, summary cards,
// queues, Source column, Monthly tag and group-by-vendor. Mock mode: bills 9 and 10 are Google Workspace subscription bills;
// bill 9 was paid from the Overseas account, so bill 10 (unpaid) is expected to sit in the Overseas book (Bills redesign D1).
test.describe('Bills redesign', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) { /* storage unavailable */ } });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  const book = (page, key) => page.locator(`#financeBookSwitcherBills [data-book="${key}"]`);

  test('the tab and the page are called Bills; Add Vendor shows only on the Vendors tab', async ({ page }) => {
    await expect(page.locator('#tabFinanceBills')).toHaveText('Bills');
    await expect(page.locator('#financeAddVendorBtn')).toBeHidden();
    await expect(page.locator('#financeUploadDraftsBtn')).toBeVisible();
    await expect(page.locator('#financeRecordBillBtn')).toBeVisible();
    await page.click('#tabFinanceVendors');
    await expect(page.locator('#financeAddVendorBtn')).toBeVisible();
    await expect(page.locator('#financeUploadDraftsBtn')).toBeHidden();
    await expect(page.locator('#financeRecordBillBtn')).toBeHidden();
    await expect(page.locator('#financeBookSwitcherBills')).toBeHidden();
    await page.click('#tabFinanceBills');
    await expect(page.locator('#financeAddVendorBtn')).toBeHidden();
    await expect(page.locator('#financeBookSwitcherBills')).toBeVisible();
  });

  test('the page heading reads Bills, matching the tab', async ({ page }) => {
    await expect(page.locator('.topbar h1').first()).toContainText('Bills');
  });

  test('the Source column is wide enough to show an account name in full', async ({ page }) => {
    await book(page, 'overseas').click();
    await page.click('#tabBillQueueAll');
    const clipped = await page.evaluate(() => [...document.querySelectorAll('#financeBillsTableBody .fv-source > span:first-child')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
    expect(clipped).toEqual([]);
  });

  test('a search shows a Search chip with how many bills match, and Clear brings every bill back', async ({ page }) => {
    await page.click('#tabBillQueueAll');
    const all = await page.locator('#financeBillsTableBody tr').count();
    await expect(page.locator('#financeBillFilterNote')).toBeHidden();
    await page.fill('#financeBillSearch', 'Slack');
    await expect(page.locator('#financeBillFilterNote')).toBeVisible();
    await expect(page.locator('#financeBillFilterText')).toHaveText('Slack');
    await expect(page.locator('#financeBillFilterCount')).toContainText(`of ${all} bills match`);
    await expect(page.locator('#financeBillsTableBody tr:has-text("Amazon")')).toHaveCount(0);
    await page.click('#financeBillFilterClear');
    await expect(page.locator('#financeBillFilterNote')).toBeHidden();
    await expect(page.locator('#financeBillSearch')).toHaveValue('');
    await expect(page.locator('#financeBillsTableBody tr')).toHaveCount(all);
  });

  test('a search left over from earlier in the tab session still shows its chip when the page reopens', async ({ page }) => {
    await page.click('#tabBillQueueAll');
    await page.fill('#financeBillSearch', 'Google');
    await expect(page.locator('#financeBillFilterNote')).toBeVisible();
    await openAdminPage(page, 'a-finance-dashboard');
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillSearch')).toHaveValue('Google');
    await expect(page.locator('#financeBillFilterText')).toHaveText('Google');
    await expect(page.locator('#financeBillFilterNote')).toBeVisible();
  });

  test('the book switch has Local, Overseas and Consolidated, and opens on Consolidated', async ({ page }) => {
    await expect(page.locator('#financeBookSwitcherBills .fv-book-switch__btn')).toHaveText(['Local', 'Overseas', 'Consolidated']);
    await expect(book(page, 'consolidated')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Overseas shows only overseas bills; unpaid bills of a vendor paid from the Overseas account follow it and say "expected"', async ({ page }) => {
    await book(page, 'overseas').click();
    await page.click('#tabBillQueueAll');
    const rows = page.locator('#financeBillsTableBody tr');
    await expect(rows).toHaveCount(2);
    const paid = rows.filter({ hasText: 'SUB-3-Google_Workspace' }).filter({ has: page.locator('.fv-status', { hasText: 'Paid' }) });
    await expect(paid).toContainText('Voyance Overseas USD');
    await expect(paid).toContainText('Overseas');
    await expect(paid).not.toContainText('expected');
    const unpaid = rows.filter({ has: page.locator('.fv-status', { hasText: 'Approved' }) });
    await expect(unpaid).toContainText('Overseas (expected)');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toHaveCount(0);

    await book(page, 'local').click();
    await page.click('#tabBillQueueAll');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("SUB-3-Google_Workspace")')).toHaveCount(0);
  });

  test('the cards follow the book and never add currencies together', async ({ page }) => {
    await expect(page.locator('#cardBillApprovalValue')).toHaveText('1');
    await expect(page.locator('#cardBillToPayValue')).toContainText('$');
    await book(page, 'overseas').click();
    await expect(page.locator('#cardBillToPayValue')).toHaveText('$398.20');
    await expect(page.locator('#cardBillOverdueValue')).toHaveText('$398.20');
    await expect(page.locator('#cardBillPaidValue')).toHaveText('$412.60');
    await expect(page.locator('#cardBillApprovalValue')).toHaveText('0');
    await expect(page.locator('#cardBillPaidNote')).toHaveText('Overseas book');
  });

  test('a card link opens its queue', async ({ page }) => {
    await page.click('#cardBillOverdueLink');
    await expect(page.locator('#tabBillQueueOverdue')).toHaveAttribute('aria-selected', 'true');
    await page.click('#cardBillToPayLink');
    await expect(page.locator('#tabBillQueueToPay')).toHaveAttribute('aria-selected', 'true');
    await page.click('#cardBillApprovalLink');
    await expect(page.locator('#financeBillStatusFilter')).toHaveValue('pending_approval');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")')).toBeVisible();
  });

  test('the book choice is remembered and carries over to Subscriptions', async ({ page }) => {
    await book(page, 'overseas').click();
    await page.click('#tabFinanceSubscriptions');
    await expect(page.locator('#financeBookSwitcherSubscriptions [data-book="overseas"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#financeBookSwitcherSubscriptions [data-book="local"]').click();
    await page.click('#subtabSpendSubBills');
    await expect(book(page, 'local')).toHaveAttribute('aria-pressed', 'true');
  });

  test('owed bills show how late or when due under the bill date; paid bills show only the date', async ({ page }) => {
    await page.click('#tabBillQueueAll');
    const overdue = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(overdue.locator('.fv-note--late')).toContainText('late');
    const paid = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")');
    await expect(paid.locator('.fv-note')).toHaveCount(0);
  });

  test('subscription bills carry a Monthly tag and the Type menu separates them from one-off bills', async ({ page }) => {
    await page.click('#tabBillQueueAll');
    const gw = page.locator('#financeBillsTableBody tr:has-text("SUB-3-Google_Workspace")');
    await expect(gw).toHaveCount(2);
    await expect(gw.first().locator('.fv-recurring-tag')).toContainText('Monthly');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001") .fv-recurring-tag')).toHaveCount(0);

    await page.selectOption('#financeBillKindFilter', 'subscription');
    await expect(page.locator('#financeBillsTableBody tr')).toHaveCount(2);
    await page.selectOption('#financeBillKindFilter', 'one_off');
    await expect(page.locator('#financeBillsTableBody tr:has-text("SUB-3-Google_Workspace")')).toHaveCount(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
  });

  test('Group by vendor folds a vendor with several bills into one line that opens to its bills', async ({ page }) => {
    await page.click('#tabBillQueueAll');
    await page.check('#financeBillGroupToggle');
    const group = page.locator('#financeBillsTableBody tr.fv-group-row:has-text("Google Workspace")');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText('2 bills');
    await expect(page.locator('#financeBillsTableBody tr.fv-group-child')).toHaveCount(0);
    await group.click();
    await expect(page.locator('#financeBillsTableBody tr.fv-group-child')).toHaveCount(2);
    await group.click();
    await expect(page.locator('#financeBillsTableBody tr.fv-group-child')).toHaveCount(0);
    await page.uncheck('#financeBillGroupToggle');
    await expect(page.locator('#financeBillsTableBody tr.fv-group-row')).toHaveCount(0);
  });

  for (const [name, width, height] of [['phone', 390, 844], ['tablet', 768, 1024]]) {
    test(`fits a ${name} screen: cards stack, no horizontal page scroll, every queue reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await expect(page.locator('#financeBillCards')).toBeVisible();
      const m = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#financeBillCards .fv-card')].map((c) => c.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          cardsInside: cards.every((r) => r.left >= 0 && r.right <= window.innerWidth + 1),
          columns: new Set(cards.map((r) => Math.round(r.left))).size,
        };
      });
      expect(m.overflow).toBe(false);
      expect(m.cardsInside).toBe(true);
      if (width < 640) expect(m.columns).toBe(1);
      for (const id of ['Attention', 'Overdue', 'ToPay', 'Paid', 'All']) await expect(page.locator(`#tabBillQueue${id}`)).toBeVisible();
    });
  }

  test('Needs attention says so when nothing needs attention in the chosen book', async ({ page }) => {
    await book(page, 'overseas').click();
    await page.selectOption('#financeBillKindFilter', 'one_off');
    await expect(page.locator('#financeBillsEmpty')).toBeVisible();
  });
});
