import { test, expect } from '@playwright/test';

const SIZES = [[375, 812, 'phone'], [768, 1024, 'tablet'], [812, 375, 'phone landscape'], [1024, 768, 'tablet landscape']];

async function open(page, id, tab) {
  await page.evaluate((i) => showSection(i, 'admin'), id);
  if (tab) await page.locator(tab).evaluate((el) => el.click());
  await page.waitForTimeout(300);
}

for (const [w, h, label] of SIZES) {
  test(`detail drawer fits and can be closed on ${label} (${w}x${h})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800 });
    const page = await ctx.newPage();
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
    const cases = [['a-finance-spend', '#tabFinanceBills', '.btn-view-bill'], ['a-finance-sales', '#tabFinanceInvoices', '.btn-view-invoice']];
    const bad = [];
    for (const [pg, tab, trigger] of cases) {
      await open(page, pg, tab);
      await page.locator(trigger).first().evaluate((el) => el.click());
      const drawer = page.locator('#financeDetailDrawer');
      await expect(drawer).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const d = document.getElementById('financeDetailDrawer').getBoundingClientRect();
        const c = document.getElementById('financeDetailDrawerCloseBtn').getBoundingClientRect();
        const body = document.getElementById('financeDrawerBody');
        const over = [];
        for (const el of document.querySelectorAll('#financeDetailDrawer *')) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          let sc = false;
          for (let p = el.parentElement; p && p.id !== 'financeDetailDrawer'; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') sc = true; }
          if (!sc && b.right > vw + 1) over.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' +' + Math.round(b.right - vw));
        }
        return { drawerRight: Math.round(d.right - vw), drawerBottom: Math.round(d.bottom - vh), closeOk: c.left >= 0 && c.right <= vw && c.top >= 0 && c.bottom <= vh, closeSize: Math.round(Math.min(c.width, c.height)), bodyScrolls: body.scrollHeight <= body.clientHeight || ['auto', 'scroll'].includes(getComputedStyle(body).overflowY), over: over.slice(0, 4) };
      });
      if (r.drawerRight > 1 || r.drawerBottom > 1 || !r.closeOk || !r.bodyScrolls || r.over.length) bad.push(pg + ' ' + JSON.stringify(r));
      await page.locator('#financeDetailDrawerCloseBtn').evaluate((el) => el.click());
      await expect(drawer).toBeHidden({ timeout: 5000 });
    }
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test(`every modal stays inside the screen on ${label} (${w}x${h})`, async ({ browser }) => {
    test.setTimeout(120000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800 });
    const page = await ctx.newPage();
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
    await page.waitForTimeout(800);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const ov of document.querySelectorAll('.modal-overlay[id]')) {
        document.querySelectorAll('.modal-overlay.active').forEach((o) => o.classList.remove('active'));
        ov.classList.add('active');
        const m = ov.querySelector('.modal');
        const f = ov.querySelector('.modal-foot, .modal-footer');
        if (m && f) {
          const mb = m.getBoundingClientRect(), fb = f.getBoundingClientRect();
          if (mb.bottom > innerHeight + 1 || mb.top < -1) out.push(ov.id + ' modal bottom+' + Math.round(mb.bottom - innerHeight) + ' top ' + Math.round(mb.top) + ' foot ' + Math.round(fb.bottom - innerHeight) + ' ov ' + getComputedStyle(m).maxHeight + '/' + getComputedStyle(m).overflowY);
        }
        ov.classList.remove('active');
      }
      return out;
    });
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });
}
