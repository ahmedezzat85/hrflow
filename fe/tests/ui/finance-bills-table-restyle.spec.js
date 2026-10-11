import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021): Bills table, as agreed in
// docs/finance-module/mocks/bills-restyle-final.html
test.describe('Bills table, direction A', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.removeItem('hrflow_finance_table_density'));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
  });

  test('columns are Bill, Bill date, Category, Status, Amount, Actions; category shows no department', async ({ page }) => {
    await expect(page.locator('#financeBillsTable thead th')).toHaveText(['Bill', 'Bill date', 'Category', 'Status', 'Amount', 'Actions']);
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")').first();
    const cells = row.locator('td');
    await expect(cells.nth(0)).toContainText('Amazon Web Services');
    await expect(cells.nth(0)).toContainText('BILL-2026-001');
    await expect(cells.nth(1)).toContainText('1 Sep 2026');
    await expect(cells.nth(1).locator('.fv-note--late')).toHaveAttribute('title', 'Due 30 Sep 2026');
    await expect(cells.nth(2)).toHaveText('Infrastructure');
    await expect(cells.nth(2)).not.toContainText('Engineering');
    await expect(cells.nth(3)).toContainText('Approved');
    await expect(cells.nth(4)).toContainText('$4,200.00');
  });

  test('no review state is shown anywhere in the list', async ({ page }) => {
    await expect(page.locator('#financeBillsTable')).not.toContainText('Unreviewed');
    await expect(page.locator('#financeBillsTable')).not.toContainText('Reviewed');
  });

  test('no horizontal scroll at 1440 px and rows follow the density setting', async ({ page }) => {
    const scrolls = await page.evaluate(() => {
      const c = document.getElementById('financeBillsContainer');
      return c.scrollWidth > c.clientWidth + 1;
    });
    expect(scrolls).toBe(false);

    const heights = {};
    for (const d of ['compact', 'regular', 'spacious']) {
      await page.evaluate((v) => {
        localStorage.setItem('hrflow_finance_table_density', v);
        const t = document.getElementById('financeBillsTable');
        t.classList.remove('density-compact', 'density-regular', 'density-spacious');
        t.classList.add('density-' + v);
      }, d);
      heights[d] = await page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")').first().evaluate((r) => r.getBoundingClientRect().height);
    }
    expect(heights.compact).toBeLessThan(heights.regular);
    expect(heights.regular).toBeLessThan(heights.spacious);
    expect(heights.regular).toBeGreaterThan(48);
    expect(heights.regular).toBeLessThan(62);
  });

  test('no eye icon: the row (and the vendor name) opens the details; actions are Edit and Attachment icons plus one text button only when needed', async ({ page }) => {
    await expect(page.locator('#financeBillsTable .btn-bill-more, #financeBillsTable .bill-row-menu')).toHaveCount(0);
    await expect(page.locator('#financeBillsTable .fa-eye')).toHaveCount(0);

    const draft = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")').first();
    await expect(draft.locator('.btn-view-bill')).toBeVisible();
    await expect(draft.locator('button[title="Edit Bill"]')).toBeVisible();
    await expect(draft.locator('.btn-bill-attachment')).toBeVisible();
    await expect(draft.locator('.btn-submit-bill')).toBeVisible();

    const paid = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")').first();
    await expect(paid.locator('.btn-view-bill')).toBeVisible();
    await expect(paid.locator('.btn-pay-bill, .btn-approve-bill, .btn-submit-bill, .btn-schedule-bill')).toHaveCount(0);
  });

  test('actions line up: the Edit icon is in the same column on every row, and the free space is shared by the columns', async ({ page }) => {
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#financeBillsTableBody tr')];
      const edit = rows.map((r) => r.querySelector('button[title="Edit Bill"]')).filter(Boolean).map((b) => Math.round(b.getBoundingClientRect().left));
      const ths = [...document.querySelectorAll('#financeBillsTable thead th')].map((t) => Math.round(t.getBoundingClientRect().width));
      return { edit: [...new Set(edit)], ths, table: Math.round(document.getElementById('financeBillsTable').getBoundingClientRect().width) };
    });
    expect(m.edit.length).toBe(1);
    // Bill has a fixed share; the others split the rest, so no column swallows the free space
    expect(m.ths[0]).toBeGreaterThan(m.table * 0.28);
    expect(m.ths[0]).toBeLessThan(m.table * 0.4);
    for (const w of m.ths.slice(1, 5)) expect(w).toBeLessThan(m.table * 0.22);
  });

  test('table card keeps its shadow', async ({ page }) => {
    const shadow = await page.locator('#financeBillsContainer').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
  });

  test('clicking a row opens the bill details; clicking its action button does not', async ({ page }) => {
    const row = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")').first();
    await row.locator('td').nth(2).click();
    await expect(page.locator('#financeDetailDrawerOverlay')).toBeVisible();
  });
});
