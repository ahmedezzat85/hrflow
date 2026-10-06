import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: '1440px', width: 1440, height: 900 },
  { name: '390px', width: 390, height: 844 },
];

const ADMIN_PAGES = [
  'a-dashboard', 'a-employees', 'a-salary', 'a-vacations',
  'a-finance-dashboard', 'a-finance-invoices', 'a-finance-bills', 'a-finance-settings',
  'a-finance-payroll-runs', 'a-finance-payroll-settings',
  'a-system-roles', 'a-system-users',
];
const EMPLOYEE_PAGES = ['e-dashboard', 'e-salary', 'e-vacations', 'e-insurance', 'e-dochub'];

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof showSection === 'function' && window.AdminNav);
}

async function visibleH1Count(page, appSel) {
  return page.evaluate((sel) => [...document.querySelectorAll(`${sel} h1`)]
    .filter((h) => h.getClientRects().length > 0).length, appSel);
}

for (const vp of VIEWPORTS) {
  test.describe(`Shell foundations at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('AC1: every admin page shows its title in the topbar (one h1)', async ({ page }) => {
      await openAdmin(page);
      for (const pageId of ADMIN_PAGES) {
        await page.evaluate((id) => showSection(id, 'admin'), pageId);
        const expected = await page.evaluate((id) => (titles[id] || [])[0], pageId);
        const h1 = page.locator('#adminPageTitle');
        await expect(h1, pageId).toBeVisible();
        await expect(h1, pageId).toHaveText(expected);
        expect(await visibleH1Count(page, '#admin-app'), pageId).toBe(1);
      }
    });

    test('AC1: every employee page shows its title in the topbar (one h1)', async ({ page }) => {
      await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof showSection === 'function');
      await expect(page.locator('#empSidebar')).toBeAttached({ timeout: 15000 });
      for (const pageId of EMPLOYEE_PAGES) {
        await page.evaluate((id) => showSection(id, 'employee'), pageId);
        const expected = await page.evaluate((id) => titles[id][0], pageId);
        await expect(page.locator('#empPageTitle'), pageId).toBeVisible();
        await expect(page.locator('#empPageTitle'), pageId).toHaveText(expected);
        expect(await visibleH1Count(page, '#employee-app'), pageId).toBe(1);
      }
    });

    test('AC2: topbar is opaque and sticky so content cannot show behind it', async ({ page }) => {
      await openAdmin(page);
      const info = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('#admin-app .topbar'));
        return { position: cs.position, bg: cs.backgroundColor, border: cs.borderBottomWidth };
      });
      expect(info.position).toBe('sticky');
      expect(info.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(info.bg).not.toBe('transparent');
      expect(info.border).not.toBe('0px');
    });
  });
}

test.describe('Shell foundations (component CSS)', () => {
  test('AC3: .btn-outline, .hide-mobile and every badge-* class have rules', async ({ page }) => {
    await openAdmin(page);
    const missing = await page.evaluate(() => {
      const selectors = [];
      const walk = (rules) => {
        for (const r of rules) {
          if (r.selectorText) selectors.push(r.selectorText);
          if (r.cssRules) walk(r.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules); } catch (e) { /* cross-origin sheet */ }
      }
      const joined = selectors.join(',');
      const wanted = ['.btn-outline', '.hide-mobile'].concat(
        ['approved', 'pending', 'rejected', 'info', 'grey', 'warning', 'danger', 'success', 'neutral', 'primary', 'indigo', 'secondary']
          .map((v) => `.badge-${v}`),
        ['.status-badge', '.status-success', '.status-warning', '.status-danger', '.status-info', '.status-neutral', '.status-primary'],
      );
      return wanted.filter((w) => !new RegExp(`${w.replace('.', '\\.')}(?![\\w-])`).test(joined));
    });
    expect(missing).toEqual([]);
  });

  test('AC3: status badges render as coloured pills', async ({ page }) => {
    await openAdmin(page);
    const styles = await page.evaluate(() => ['approved', 'rejected', 'pending', 'grey'].map((v) => {
      const el = document.createElement('span');
      el.className = `badge badge-${v}`;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
      el.remove();
      return out;
    }));
    for (const s of styles) {
      expect(s.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(parseFloat(s.radius)).toBeGreaterThan(10);
    }
    expect(new Set(styles.map((s) => s.bg)).size).toBeGreaterThan(2);
  });

  test('AC4: shared button has identical metrics in HR and Payroll', async ({ page }) => {
    await openAdmin(page);
    const metrics = await page.evaluate(() => {
      const probe = (hostSel, cls) => {
        const host = document.querySelector(hostSel);
        const b = document.createElement('button');
        b.className = cls;
        host.appendChild(b);
        const cs = getComputedStyle(b);
        const m = {
          radius: cs.borderTopLeftRadius, font: cs.fontSize, padding: cs.padding,
          weight: cs.fontWeight, border: cs.borderTopWidth,
        };
        b.remove();
        return m;
      };
      return ['btn', 'btn btn-fill', 'btn btn-sm'].map((cls) => ({
        cls, hr: probe('#a-employees', cls), payroll: probe('#a-finance-payroll', cls),
      }));
    });
    for (const m of metrics) expect(m.payroll, m.cls).toEqual(m.hr);
  });

  test('AC6: Add Transaction is Finance-only', async ({ page }) => {
    await openAdmin(page);
    const btn = page.locator('#adminQuickAddTxBtn');
    for (const id of ['a-employees', 'a-finance-payroll-runs', 'a-finance-payroll-settings', 'a-system-roles']) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await expect(btn, id).toBeHidden();
    }
    for (const id of ['a-finance-dashboard', 'a-finance-invoices']) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await expect(btn, id).toBeVisible();
    }
  });

  test('AC6: Add Transaction is absent from the employee portal', async ({ page }) => {
    await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#empSidebar')).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#adminQuickAddTxBtn')).toBeHidden();
  });

  test('AC7: a single escapeHtml implementation is shared', async ({ page }) => {
    await openAdmin(page);
    const out = await page.evaluate(() => {
      const raw = `<b a="1">&'x'`;
      return {
        core: escapeHtml(raw),
        fin: FinanceFormat.escapeHtml(raw),
        nul: escapeHtml(null),
        text: (() => { const d = document.createElement('div'); setText(d, '<i>'); return d.textContent; })(),
      };
    });
    expect(out.core).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;x&#39;');
    expect(out.fin).toBe(out.core);
    expect(out.nul).toBe('');
    expect(out.text).toBe('<i>');
  });
});

test.describe('R3 one button set', () => {
  const ALL_PAGES = [...ADMIN_PAGES, 'a-requests', 'a-invoices', 'a-insurance', 'a-dochub',
    'a-finance-sales', 'a-finance-spend', 'a-finance-banking', 'a-finance-reports'];

  async function visitAll(page, check) {
    await openAdmin(page);
    const out = {};
    for (const id of ALL_PAGES) {
      await page.evaluate((p) => showSection(p, 'admin'), id);
      await page.waitForTimeout(250);
      out[id] = await page.evaluate(check);
    }
    return out;
  }

  test('R3-1: no button has a box-shadow at rest', async ({ page }) => {
    const res = await visitAll(page, () => [...document.querySelectorAll('#admin-app button')]
      .filter((b) => b.offsetParent !== null && getComputedStyle(b).boxShadow !== 'none')
      .map((b) => `${b.id || b.className}`.slice(0, 60)));
    for (const [id, shadowed] of Object.entries(res)) expect(shadowed, id).toEqual([]);
  });

  test('R3-2: buttons of one size share one border radius', async ({ page }) => {
    const res = await visitAll(page, () => {
      const radii = { default: new Set(), small: new Set() };
      document.querySelectorAll('#admin-app button.btn, #admin-app a.btn').forEach((b) => {
        if (b.offsetParent === null) return;
        radii[b.classList.contains('btn-sm') ? 'small' : 'default'].add(getComputedStyle(b).borderTopLeftRadius);
      });
      return { default: [...radii.default], small: [...radii.small] };
    });
    const seen = { default: new Set(), small: new Set() };
    for (const r of Object.values(res)) { r.default.forEach((v) => seen.default.add(v)); r.small.forEach((v) => seen.small.add(v)); }
    expect([...seen.default]).toEqual(['10px']);
    expect([...seen.small]).toEqual(['10px']);
  });

  test('R3-3: the four named screens each show exactly one primary button', async ({ page }) => {
    const res = await visitAll(page, () => [...document.querySelectorAll('#admin-app .btn-fill')]
      .filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim().slice(0, 30)));
    for (const id of ['a-salary', 'a-invoices', 'a-finance-dashboard', 'a-finance-payroll-runs']) {
      expect(res[id], id).toHaveLength(1);
    }
  });

  test('R3-4: a disabled primary uses the neutral surface, not the accent', async ({ page }) => {
    await openAdmin(page);
    const out = await page.evaluate(() => {
      const host = document.querySelector('#a-employees');
      const mk = (cls, disabled) => {
        const b = document.createElement('button'); b.className = cls; b.disabled = disabled; host.appendChild(b);
        const cs = getComputedStyle(b); const r = { bg: cs.backgroundColor, img: cs.backgroundImage, op: cs.opacity, shadow: cs.boxShadow };
        b.remove(); return r;
      };
      const probe = document.createElement('div'); probe.style.background = 'var(--surface2)'; host.appendChild(probe);
      const surface = getComputedStyle(probe).backgroundColor; probe.remove();
      return { surface, primary: mk('btn btn-fill', false), disabled: mk('btn btn-fill', true) };
    });
    expect(out.disabled.bg).toBe(out.surface);
    expect(out.disabled.bg).not.toBe(out.primary.bg);
    expect(out.disabled.img).toBe('none');
    expect(out.disabled.op).toBe('1');
  });
});
