import { test, expect } from '@playwright/test';

const ADMIN_PAGES = [
  'a-dashboard', 'a-employees', 'a-employee-detail', 'a-requests', 'a-salary', 'a-invoices', 'a-vacations', 'a-insurance', 'a-dochub',
  'a-finance-dashboard', 'a-finance-invoices', 'a-finance-bills', 'a-finance-subscriptions', 'a-finance-statutory', 'a-finance-accounts',
  'a-finance-reports', 'a-finance-settings', 'a-finance-payroll-runs', 'a-finance-payroll-settings', 'a-system-roles', 'a-system-users',
];
const EMPLOYEE_PAGES = ['e-dashboard', 'e-salary', 'e-payslips', 'e-vacations', 'e-insurance', 'e-dochub'];

async function openAdmin(page, url = '/?mock=admin') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Router && typeof showSection === 'function' && window.PayrollApp);
  await page.waitForTimeout(400);
}

// ---- in-page helpers (serialised into page.evaluate) ----
const SCAN = () => {
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) base = { r: 15, g: 17, b: 23, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    return true;
  };
  const root = document.querySelector('#admin-app.active, #employee-app.active') || document.body;
  const section = root.querySelector('.page-section.active') || root;

  // 1. tables wider than the viewport
  const wide = [...section.querySelectorAll('table')].filter((t) => visible(t) && t.getBoundingClientRect().width > window.innerWidth + 1
    && !t.closest('.table-wrap, [style*="overflow"]'))
    .map((t) => t.id || t.className || 'table');
  // 2. duplicate ids
  const seen = {}; const dups = [];
  document.querySelectorAll('[id]').forEach((e) => { if (seen[e.id]) dups.push(e.id); seen[e.id] = true; });
  // 3. touch targets
  const ctl = [...section.querySelectorAll('button, a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=button]')].filter(visible);
  const small = ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; });
  // 4. contrast
  const low = [];
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
  const done = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; const el = t.parentElement;
    if (!el || done.has(el) || !t.textContent.trim() || !visible(el)) continue;
    if (el.closest('[disabled], .disabled, script, style')) continue;
    done.add(el);
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el);
    const fgc = over({ ...fg, a: fg.a * 1 }, bg);
    const L1 = lum([fgc.r, fgc.g, fgc.b]); const L2 = lum([bg.r, bg.g, bg.b]);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) low.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${t.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
  }
  return {
    wide, dups: [...new Set(dups)], controls: ctl.length, smallCount: small.length,
    smallSample: small.slice(0, 6).map((e) => `${e.tagName.toLowerCase()}#${e.id || ''}.${String(e.className).split(' ')[0]}`),
    low: low.slice(0, 8), lowCount: low.length,
  };
};

test.describe('U9 phone layouts, touch targets, contrast and ids', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('375px: no table wider than the viewport on any admin page', async ({ page }) => {
    await openAdmin(page);
    const problems = [];
    for (const id of ADMIN_PAGES) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await page.waitForTimeout(150);
      const r = await page.evaluate(SCAN);
      if (r.wide.length) problems.push(`${id}: ${r.wide.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  test('375px: employee portal pages have no wide tables', async ({ page }) => {
    await openAdmin(page, '/?mock=employee');
    const problems = [];
    for (const id of EMPLOYEE_PAGES) {
      await page.evaluate((p) => showSection(p, 'employee'), id);
      await page.waitForTimeout(150);
      const r = await page.evaluate(SCAN);
      if (r.wide.length) problems.push(`${id}: ${r.wide.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  test('375px: fewer than 5% of visible controls are under 44px on every page', async ({ page }) => {
    await openAdmin(page);
    const problems = [];
    for (const id of ADMIN_PAGES) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await page.waitForTimeout(150);
      const r = await page.evaluate(SCAN);
      if (r.controls && r.smallCount / r.controls >= 0.05) problems.push(`${id}: ${r.smallCount}/${r.controls} e.g. ${r.smallSample.join(' ')}`);
    }
    expect(problems).toEqual([]);
  });

  test('no duplicate ids on any page', async ({ page }) => {
    await openAdmin(page);
    const problems = [];
    for (const id of ADMIN_PAGES) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      const r = await page.evaluate(SCAN);
      if (r.dups.length) problems.push(`${id}: ${r.dups.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  for (const theme of ['light', 'dark']) {
    test(`text contrast reaches 4.5:1 on the main pages (${theme})`, async ({ page }) => {
      await openAdmin(page);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const problems = [];
      for (const id of ['a-dashboard', 'a-employees', 'a-salary', 'a-finance-dashboard', 'a-finance-invoices', 'a-finance-bills', 'a-finance-settings', 'a-finance-payroll-runs']) {
        await page.evaluate((p) => showSection(p, 'admin'), id);
        await page.waitForTimeout(150);
        const r = await page.evaluate(SCAN);
        if (r.lowCount > 3) problems.push(`${id}: ${r.lowCount} e.g. ${r.low.slice(0, 4).join(' | ')}`);
      }
      expect(problems).toEqual([]);
    });
  }

  test('contrast token pairs', async ({ page }) => {
    await openAdmin(page);
    const rows = await page.evaluate(() => {
      const probe = (theme, cssColor, cssBg) => {
        document.documentElement.setAttribute('data-theme', theme);
        const el = document.createElement('div');
        el.style.cssText = `color:${cssColor};background:${cssBg};position:fixed`;
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const out = [cs.color, cs.backgroundColor];
        el.remove();
        return out;
      };
      const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number); const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const out = [];
      for (const theme of ['light', 'dark']) {
        for (const fg of ['--text', '--text2', '--text3', '--accent-text', '--success', '--warning', '--danger', '--info', '--purple']) {
          for (const bg of ['--surface', '--surface2', '--bg']) {
            const [c, b] = probe(theme, `var(${fg})`, `var(${bg})`);
            out.push({ theme, fg, bg, ratio: ratio(c, b) });
          }
        }
      }
      document.documentElement.setAttribute('data-theme', 'light');
      return out;
    });
    const failing = rows.filter((r) => r.ratio < 4.5).map((r) => `${r.theme} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });
});
