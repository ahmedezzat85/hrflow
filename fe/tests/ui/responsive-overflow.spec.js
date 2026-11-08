import { test, expect } from '@playwright/test';

// Finance sub-pages hang off a parent page and a tab; drive them directly so the
// off-canvas phone sidebar does not get in the way of the test.
const FIN_PARENT = {
  'a-finance-invoices': ['a-finance-sales', '#tabFinanceInvoices'],
  'a-finance-bills': ['a-finance-spend', '#tabFinanceBills'],
  'a-finance-subscriptions': ['a-finance-spend', '#tabFinanceSubscriptions'],
  'a-finance-statutory': ['a-finance-spend', '#tabFinanceStatutory'],
  'a-finance-accounts': ['a-finance-banking', '#subtabFinanceAccounts'],
  'a-finance-payroll': ['a-finance-payroll-runs', null],
};
async function openFinance(page, id) {
  const [parent, tab] = FIN_PARENT[id] || [id, null];
  await page.evaluate(([pid]) => showSection(pid, 'admin'), [parent]);
  if (tab) await page.locator(tab).evaluate((el) => el.click());
}

const ADMIN = ['a-dashboard', 'a-employees', 'a-requests', 'a-vacations', 'a-salary', 'a-insurance', 'a-dochub', 'a-holidays', 'a-invoices', 'a-history-import', 'a-system-users', 'a-finance-dashboard', 'a-finance-invoices', 'a-finance-bills', 'a-finance-subscriptions', 'a-finance-statutory', 'a-finance-accounts', 'a-finance-payroll', 'a-finance-reports', 'a-finance-settings'];
const EMP = ['e-dashboard', 'e-vacations', 'e-salary', 'e-insurance', 'e-payslips', 'e-dochub', 'e-holidays'];
const VIEWPORTS = [[375, 812, true], [768, 1024, true], [1024, 768, false]];

// What overflows the viewport horizontally, ignoring anything inside a scroll container.
function audit() {
  const vw = document.documentElement.clientWidth;
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (r.right > vw + 1 && !inScroller(el)) {
      // skip things hidden by an ancestor that clips (off-canvas sidebar etc.)
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).display === 'none') { clipped = true; break; }
      }
      if (!clipped) bad.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(r.right - vw));
    }
  }
  const scroller = document.scrollingElement;
  return { docOverflow: scroller.scrollWidth - scroller.clientWidth, bad: bad.slice(0, 6) };
}

for (const [w, h, touch] of VIEWPORTS) {
  test(`no horizontal page overflow at ${w}px`, async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 800 });
    const page = await ctx.newPage();
    const failures = [];
    for (const [mock, pages] of [['admin', ADMIN], ['employee', EMP]]) {
      await page.goto('/?mock=' + mock, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(mock === 'admin' ? '#adminSidebar' : 'body')).toBeAttached({ timeout: 15000 });
      await page.waitForTimeout(800);
      for (const p of pages) {
        if (mock === 'admin' && p.startsWith('a-finance')) {
          await openFinance(page, p);
        } else {
          await page.evaluate(([id, m]) => showSection(id, m), [p, mock]);
        }
        await page.waitForTimeout(150);
        const r = await page.evaluate(audit);
        if (r.docOverflow > 0 || r.bad.length) failures.push(`${p}: doc+${r.docOverflow} ${r.bad.join(' | ')}`);
      }
    }
    await ctx.close();
    expect(failures, failures.join('\n')).toEqual([]);
  });
}

test('employees toolbar keeps Add employee fully inside the phone viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.evaluate(() => showSection('a-employees', 'admin'));
  const btn = page.locator('#btnAddEmployee');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await ctx.close();
});

test('finance controls are touch sized on a tablet', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  const small = [];
  for (const [id, tab] of [['a-finance-dashboard'], ['a-finance-sales', '#tabFinanceInvoices'], ['a-finance-spend', '#tabFinanceBills'], ['a-finance-banking', '#subtabFinanceAccounts']]) {
    await page.evaluate((i) => showSection(i, 'admin'), id);
    if (tab) await page.locator(tab).evaluate((el) => el.click());
    await page.waitForTimeout(250);
    small.push(...await page.evaluate((pid) => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], select')) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || el.closest('#adminSidebar') || el.classList.contains('fv-sr-only')) continue;
        if (b.height < 39 || b.width < 39) out.push(pid + ' ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      }
      return out;
    }, id));
  }
  await ctx.close();
  expect(small, small.slice(0, 8).join('\n')).toEqual([]);
});
