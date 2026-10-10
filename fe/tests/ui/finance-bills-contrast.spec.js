import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle, direction A (D-021), Slice 6: every restyled Bills text/background pair is at least 4.5:1 in light and dark.
const STATUSES = ['draft', 'pending_approval', 'rejected', 'approved', 'scheduled', 'partially_paid', 'paid', 'void'];

for (const theme of ['light', 'dark']) {
  test(`Bills restyle contrast >= 4.5:1 in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();

    expect(await page.evaluate(() => typeof window._billStatusPill === 'function' && typeof window._billFlags === 'function')).toBe(true);

    const results = await page.evaluate((statuses) => {
      const parse = (c) => {
        // color-mix() tints compute to color(srgb r g b / a) with 0..1 channels
        const cs = c.match(/color\(srgb ([^)]+)\)/);
        if (cs) {
          const q = cs[1].split(/[ /]+/).filter(Boolean).map(Number);
          return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 };
        }
        const m = c.match(/rgba?\(([^)]+)\)/);
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (top, bottom) => ({
        r: top.r * top.a + bottom.r * (1 - top.a),
        g: top.g * top.a + bottom.g * (1 - top.a),
        b: top.b * top.a + bottom.b * (1 - top.a),
        a: 1,
      });
      const bgOf = (el) => {
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.push(getComputedStyle(n).backgroundColor);
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = chain.length - 1; i >= 0; i--) {
          const c = parse(chain[i]);
          if (c.a > 0) bg = over(c, bg);
        }
        return bg;
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (el) => {
        const fg = over(parse(getComputedStyle(el).color), bgOf(el));
        const a = lum(fg), b = lum(bgOf(el));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };

      const host = document.createElement('div');
      host.className = 'card';
      host.id = 'contrastHost';
      host.innerHTML =
        statuses.map((s) => `<div data-k="pill ${s}">${window._billStatusPill ? window._billStatusPill(s) : ''}</div>`).join('') +
        `<div data-k="flags">${window._billFlags ? window._billFlags({ is_overdue: true, due_date: '2020-01-01', vendor_to_confirm: true }) : ''}</div>` +
        '<div class="fv-note fv-note--late" data-k="late note">3 days late</div>' +
        '<div class="fv-sub" data-k="sub">BILL-1 · 1 Sep 2026</div>' +
        '<div class="fv-cell-main__name" data-k="main">Vendor</div>' +
        `<div data-k="all flags">${window._billFlags({ is_overdue: true, due_date: '2020-01-01', is_duplicate_override: true, extraction_confidence: 0.7, is_reviewed: false })}</div>`;
      document.getElementById('a-finance-bills').appendChild(host);

      const out = {};
      host.querySelectorAll('[data-k]').forEach((w) => {
        const target = w.querySelector('.fv-status, .bill-flag') ? [...w.querySelectorAll('.fv-status, .bill-flag')] : [w];
        target.forEach((el, i) => { out[w.dataset.k + (target.length > 1 ? ` #${i}` : '')] = ratio(el); });
      });
      document.querySelectorAll('#financeBillWorkQueueTabs .filter-tab').forEach((t, i) => { out[`status tab ${i}${t.classList.contains('active') ? ' (active)' : ''}`] = ratio(t); });
      document.querySelectorAll('#financeBillSubNav .filter-tab').forEach((t, i) => { out[`sub-nav tab ${i}${t.classList.contains('active') ? ' (active)' : ''}`] = ratio(t); });
      host.remove();
      return out;
    }, STATUSES);

    expect(Object.keys(results).length).toBeGreaterThan(20);
    expect(Object.keys(results).filter((k) => k.startsWith('pill ')).length).toBe(STATUSES.length);
    expect(Object.keys(results).filter((k) => k.startsWith('flags #')).length).toBe(2);
    expect(Object.keys(results).filter((k) => k.startsWith('all flags #')).length).toBe(3);
    const failing = Object.entries(results).filter(([, v]) => v < 4.5).map(([k, v]) => `${k}: ${v.toFixed(2)}`);
    expect(failing, `Below 4.5:1 in ${theme}`).toEqual([]);
  });
}
