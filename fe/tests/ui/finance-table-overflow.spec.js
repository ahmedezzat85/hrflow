import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Regression: action buttons, badges and inputs must stay inside their own table cell at any desktop
// width (narrow windows scroll the table sideways instead of letting cells spill over each other).
const PAGES = [
  ['a-finance-invoices', []],
  ['a-finance-bills', []],
  ['a-finance-subscriptions', []],
  ['a-finance-statutory', []],
  ['a-finance-accounts', ['#subtabFinanceLedger', '#subtabFinanceStatements', '#subtabFinanceCheques', '#subtabFinanceTransfers']],
  ['a-finance-payroll', []],
];

for (const width of [1000, 1280, 1600, 1920]) {
  test(`finance tables keep their controls inside their cells at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    const spill = [];
    for (const [pid, tabs] of PAGES) {
      await openAdminPage(page, pid);
      for (const t of ['', ...tabs]) {
        if (t) await page.click(t);
        await page.waitForTimeout(250);
        const found = await page.evaluate(() => {
          const res = [];
          document.querySelectorAll('table').forEach((tb) => {
            if (!tb.offsetParent || tb.getBoundingClientRect().width === 0) return;
            tb.querySelectorAll('td').forEach((td) => {
              const c = td.getBoundingClientRect();
              td.querySelectorAll('button, a.btn, .fv-pill, .fv-status, input, select').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width === 0) return;
                if (r.right > c.right + 2 || r.left < c.left - 2) res.push(`${tb.id || tb.className} col${td.cellIndex + 1} <${el.tagName.toLowerCase()}>`);
              });
            });
          });
          return [...new Set(res)];
        });
        found.forEach((f) => spill.push(`${pid}${t ? ' ' + t : ''}: ${f}`));
      }
    }
    expect(spill).toEqual([]);
  });
}
