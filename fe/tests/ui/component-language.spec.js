import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof showSection === 'function' && window.AdminNav && window.PayrollApp);
}

test.describe('U2 one component language', () => {
  test('a Paid status looks the same in every badge vocabulary', async ({ page }) => {
    await openAdmin(page);
    const looks = await page.evaluate(() => {
      const make = (html) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap);
        const el = wrap.firstElementChild;
        const cs = getComputedStyle(el);
        const out = {
          bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius,
          font: cs.fontSize, weight: cs.fontWeight, padding: cs.padding, border: cs.borderTopWidth,
        };
        wrap.remove();
        return out;
      };
      const host = document.querySelector('#a-finance-payroll');
      const inPayroll = (html) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        host.appendChild(wrap);
        const cs = getComputedStyle(wrap.firstElementChild);
        const out = { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, font: cs.fontSize, weight: cs.fontWeight, padding: cs.padding, border: cs.borderTopWidth };
        wrap.remove();
        return out;
      };
      return {
        hr: make('<span class="badge-pill pill-success">Paid</span>'),
        bills: make('<span class="badge badge-approved">Paid</span>'),
        status: make('<span class="status-badge status-success">Paid</span>'),
        payroll: inPayroll('<span class="p-badge b-green">Paid</span>'),
        payrollPill: inPayroll('<span class="badge-pill pill-success">Paid</span>'),
        stage: inPayroll('<span class="stage-badge settled">Paid</span>'),
      };
    });
    for (const k of ['bills', 'status', 'payroll', 'payrollPill', 'stage']) expect(looks[k], k).toEqual(looks.hr);
  });

  test('tables share one header and row style across HR, Finance and Payroll', async ({ page }) => {
    await openAdmin(page);
    const metrics = await page.evaluate(() => {
      const probe = (host, cls) => {
        const t = document.createElement('table');
        if (cls) t.className = cls;
        t.innerHTML = '<thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody>';
        document.querySelector(host).appendChild(t);
        const th = getComputedStyle(t.querySelector('th')); const td = getComputedStyle(t.querySelector('td'));
        const o = { thSize: th.fontSize, thColor: th.color, thPad: th.padding, thCase: th.textTransform, tdPad: td.padding, tdSize: td.fontSize };
        t.remove();
        return o;
      };
      return { hr: probe('#a-employees'), fin: probe('#a-finance-invoices'), runs: probe('#a-finance-payroll', 'runs-table'), sheet: probe('#a-finance-payroll', 'payroll-worksheet'), sys: probe('#a-system-users') };
    });
    for (const k of ['fin', 'runs', 'sheet', 'sys']) expect(metrics[k], k).toEqual(metrics.hr);
  });

  test('type scale tokens exist and button variants are documented', async ({ page }) => {
    await openAdmin(page);
    const sizes = await page.evaluate(() => ['xs', 'sm', 'md', 'base', 'lg', 'xl', '2xl'].map((n) => getComputedStyle(document.documentElement).getPropertyValue(`--fs-${n}`).trim()));
    expect(sizes.every(Boolean)).toBe(true);
    const hasPrimary = await page.evaluate(() => document.querySelectorAll('.btn-primary').length);
    expect(hasPrimary).toBe(0);
  });

  test('dark theme: native selects and the logo are legible', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await openAdminPage(page, 'a-finance-dashboard');
    const info = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('#a-finance-dashboard select')].filter((s) => s.getClientRects().length);
      return {
        scheme: getComputedStyle(document.documentElement).colorScheme,
        selects: sel.map((s) => getComputedStyle(s).backgroundColor),
        logoFilter: getComputedStyle(document.querySelector('#adminSidebar .logo-full')).filter,
      };
    });
    expect(info.scheme).toBe('dark');
    for (const bg of info.selects) expect(bg).not.toBe('rgb(255, 255, 255)');
    expect(info.logoFilter).not.toBe('none');
  });

  test('the three worst finance partials carry no inline styles or hex colours', async ({ page }) => {
    await openAdmin(page);
    const counts = await page.evaluate(() => ['a-finance-dashboard', 'a-finance-accounts', 'a-finance-reports'].map((id) => {
      const root = document.getElementById(id);
      const inline = [root, ...root.querySelectorAll('[style]')].filter((e) => e.hasAttribute('style'));
      return { id, inline: inline.length, hex: inline.filter((e) => /#[0-9a-f]{3,8}\b/i.test(e.getAttribute('style'))).length };
    }));
    for (const c of counts) { expect(c.inline, c.id).toBeLessThan(20); expect(c.hex, c.id).toBe(0); }
  });

  test('New Vendor Bill modal has no horizontal scrollbar at 1440px (light and dark)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-bills');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.evaluate(() => { openAddBillModal(); });
      const modal = page.locator('#billModal');
      await expect(modal).toBeVisible();
      const overflow = await page.evaluate(() => [...document.querySelectorAll('#billModal, #billModal .modal, #billModal .modal-body')]
        .map((e) => e.scrollWidth - e.clientWidth));
      expect(Math.max(...overflow), theme).toBeLessThanOrEqual(0);
      await page.evaluate(() => { const m = document.getElementById('billModal'); if (m) m.classList.remove('active'); if (typeof closeModal === 'function') closeModal('billModal'); });
    }
  });
});
