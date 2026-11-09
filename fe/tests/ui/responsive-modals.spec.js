import { test, expect } from '@playwright/test';

// Opens every modal overlay in turn at phone width and checks nothing inside it
// runs past the right edge of the screen or below a scrollable body.
for (const [w, h] of [[375, 812], [768, 1024]]) {
  test(`modals fit the screen at ${w}px`, async ({ browser }) => {
    test.setTimeout(200000);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800 });
    const page = await ctx.newPage();
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
    await page.waitForTimeout(1000);
    const ids = await page.evaluate(() => [...document.querySelectorAll('.modal-overlay[id]')].map((e) => e.id));
    expect(ids.length).toBeGreaterThan(20);
    const bad = [];
    for (const id of ids) {
      const r = await page.evaluate((mid) => {
        const ov = document.getElementById(mid);
        document.querySelectorAll('.modal-overlay.active').forEach((o) => o.classList.remove('active'));
        ov.classList.add('active');
        const vw = document.documentElement.clientWidth;
        const out = [];
        for (const el of ov.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
          let hidden = false, scroller = false;
          for (let p = el; p && p !== ov; p = p.parentElement) {
            const c = getComputedStyle(p);
            if (c.display === 'none') hidden = true;
            if (p !== el && (c.overflowX === 'auto' || c.overflowX === 'scroll')) scroller = true;
          }
          if (hidden || scroller) continue;
          if (b.right > vw + 1) out.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' +' + Math.round(b.right - vw));
        }
        ov.classList.remove('active');
        return out.slice(0, 4);
      }, id);
      if (r.length) bad.push(id + ': ' + r.join(' | '));
    }
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });
}
