import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle v2 (D-027, doc 21): structural checks on computed styles.
// Extended slice by slice; mock mode only.

async function openAdmin(page, theme = 'light', size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

const css = (page, selector, prop) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

const rgb = (page, value) =>
  page.evaluate((v) => {
    const probe = document.createElement('i');
    probe.style.color = v;
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);

test.describe('Finance restyle v2: foundations (S1)', () => {
  test('tokens resolve in light and dark', async ({ page }) => {
    await openAdmin(page, 'light');
    const read = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    expect(await read('--ink-strong')).toBe('#16245e');
    expect(await read('--brand')).toBe('#2056e8');
    expect(await read('--id-teal')).toBe('#0f9d8c');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await read('--ink-strong')).toBe('#e9eeff');
    expect(await read('--id-teal')).toBe('#1f9d8e');
    expect(await read('--fv-canvas')).toBe('#0f1117');
  });

  test('FinanceUI helpers: hue by id, initials, markup is class based', async ({ page }) => {
    await openAdmin(page);
    const out = await page.evaluate(() => ({
      h1: FinanceUI.hueForId(1), h8: FinanceUI.hueForId(8), h9: FinanceUI.hueForId(9),
      cat: FinanceUI.hueForCategory({ id: 3, name: 'SaaS', color: 'pink' }, []),
      catFallback: FinanceUI.hueForCategory({ id: 2, name: 'Rent' }, [{ id: 1 }, { id: 2 }]),
      catOther: FinanceUI.hueForCategory({ id: 9, name: 'Other' }, []),
      ini: FinanceUI.initials('Amazon Web Services'), ini1: FinanceUI.initials('Slack'),
      date: FinanceUI.formatDate('2026-09-01'),
      pill: FinanceUI.statusPill('paid', '<b>Paid</b>'),
      av: FinanceUI.avatar('Amazon Web Services', 'orange'),
      rows: FinanceUI.rowActions({ primary: { label: 'Pay', onclick: 'x()' }, icons: [1, 2, 3, 4].map((n) => ({ icon: 'fa-pen', label: 'L' + n })) }),
      money: FinanceUI.amountCell(470000, 'EGP'),
    }));
    expect([out.h1, out.h8, out.h9]).toEqual(['blue', 'ochre', 'blue']);
    expect(out.cat).toBe('pink');
    expect(out.catFallback).toBe('orange');
    expect(out.catOther).toBe('faint');
    expect(out.ini).toBe('AW');
    expect(out.ini1).toBe('SL');
    expect(out.date).toBe('1 Sep 2026');
    expect(out.pill).toContain('fv-status--settled');
    expect(out.pill).not.toContain('<b>');
    expect(out.av).not.toMatch(/style=|#[0-9a-f]{3,6}/i);
    expect((out.rows.match(/fv-icon-btn/g) || []).length).toBe(3);
    expect(out.money).toContain('<span class="fv-cur">EGP</span>');
  });

  test('Finance pages get the canvas, area tile and compact top bar; HR pages do not', async ({ page }) => {
    await openAdmin(page);
    const canvas = await rgb(page, '#f4f6fd');
    const areas = [
      ['a-finance-dashboard', 'Overview'],
      ['a-finance-invoices', 'Sales'],
      ['a-finance-bills', 'Spend'],
      ['a-finance-accounts', 'Banking'],
      ['a-finance-reports', 'Reports'],
      ['a-finance-settings', 'Settings'],
    ];
    for (const [pageId, area] of areas) {
      await openAdminPage(page, pageId);
      await expect(page.locator('#adminAreaName')).toHaveText(area);
      await expect(page.locator('#adminAreaTile')).toBeVisible();
      expect(await css(page, '#admin-app .main', 'backgroundColor')).toBe(canvas);
      expect(await css(page, '#adminQuickAddTxBtn', 'height')).toBe('30px');
      expect(await css(page, '#adminQuickAddTxBtn i', 'display')).toBe('none');
      expect(await css(page, '#adminPageTitle', 'fontSize')).toBe('16px');
    }
  });

  test('Payroll and HR pages keep the existing chrome', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-finance-payroll-runs', 'admin'));
    await expect(page.locator('#adminAreaTile')).toBeHidden();
    await expect(page.locator('#admin-app .main.fv-shell')).toHaveCount(0);
    await page.evaluate(() => showSection('a-dashboard', 'admin'));
    await expect(page.locator('#adminAreaName')).toBeHidden();
    await expect(page.locator('#admin-app .main.fv-shell')).toHaveCount(0);
    expect(await css(page, '#adminPageTitle', 'fontSize')).not.toBe('16px');
  });
});
