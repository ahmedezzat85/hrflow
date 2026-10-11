import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance restyle v2 (D-027, doc 21 section 3.2 and 4.5): every text/background pair on the restyled
// Finance pages and dialogs is at least 4.5:1 (3:1 for large text) in light and dark.
// Exempt by design: zero-count pills (55% opacity, doc 21 section 3.4) and the gradient hero card,
// which is checked separately (white on both gradient stops).

const PAGES = [
  ['overview', 'a-finance-dashboard', null, '.finance-attention-row'],
  ['invoices', 'a-finance-invoices', null, '#financeInvoicesTableBody tr'],
  ['customers', 'a-finance-invoices', "switchInvoiceSubTab('customers')", '#financeCustomersTableBody tr'],
  ['bills', 'a-finance-bills', null, '#financeBillsTableBody tr'],
  ['vendors', 'a-finance-bills', "switchBillSubTab('vendors')", '#financeVendorsTableBody tr'],
  ['subscriptions', 'a-finance-subscriptions', null, '#financeSubscriptionsTableBody tr'],
  ['statutory', 'a-finance-statutory', null, '#financeStatutoryTableBody tr'],
  ['accounts', 'a-finance-accounts', null, '#financeAccountsTableBody tr'],
  ['ledger', 'a-finance-accounts', "switchFinanceAccountsSubTab('ledger')", '#financeLedgerTableBody tr'],
  ['statements', 'a-finance-accounts', "switchFinanceAccountsSubTab('statements')", '#statementImportsTableBody tr'],
  ['cheques', 'a-finance-accounts', "switchFinanceAccountsSubTab('cheques')", '#financeChequesTableBody tr'],
  ['reports', 'a-finance-reports', null, '#reportLibraryGrid tr'],
  ['settings categories', 'a-finance-settings', null, '#financeCategoriesTableBody tr'],
  ['settings payment types', 'a-finance-settings', "switchFinanceSettingsSubTab('payment_types')", '#financePaymentTypesTableBody tr'],
];

const DIALOGS = [
  ['new bill', 'a-finance-bills', 'openAddBillModal()', '#billModal.active'],
  ['pay bill', 'a-finance-bills', 'setTimeout(() => openBillPaymentModal(1), 400)', '#billPaymentModal.active'],
  ['approve bill', 'a-finance-bills', "setBillWorkQueue('pending_approval'); setTimeout(() => openBillApprovalModal(5), 700)", '#billApprovalModal.active'],
  ['new invoice', 'a-finance-invoices', 'openAddInvoiceModal()', '#invoiceModal.active'],
  ['record receipt', 'a-finance-invoices', 'setTimeout(() => openPaymentModal(1), 500)', '#invoicePaymentModal.active'],
  ['remittance', 'a-finance-statutory', 'setTimeout(() => openStatutorySettleModal(5), 500)', '#statutorySettleModal.active'],
  ['transfer', 'a-finance-accounts', 'openRecordFinanceTransferModal()', '#financeTransferModal.active'],
  ['issue cheque', 'a-finance-accounts', 'openIssueChequeModal()', '#financeChequeModal.active'],
  ['transaction', 'a-finance-accounts', "openAddFinanceTransactionModal('money_out', true)", '#financeTransactionModal.active'],
  ['category', 'a-finance-settings', 'openAddFinanceCategoryModal()', '#financeCategoryModal.active'],
  ['drawer', 'a-finance-invoices', "setTimeout(() => FinanceDrawer.open('invoice', 1), 500)", '#financeDetailDrawerOverlay'],
];

const SCAN = (rootSelector) => {
  const parse = (c) => {
    const cs = c.match(/color\(srgb ([^)]+)\)/);
    if (cs) {
      const q = cs[1].split(/[ /]+/).filter(Boolean).map(Number);
      return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 };
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const pageBg = dark ? { r: 15, g: 17, b: 23, a: 1 } : { r: 244, g: 246, b: 253, a: 1 };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient or image: skipped
    }
    let base = pageBg;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (e.hidden) return false;
    }
    return true;
  };
  const root = document.querySelector(rootSelector);
  if (!root) return { error: `no ${rootSelector}` };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const done = new Set();
  const low = [];
  let checked = 0;
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || done.has(el) || !walker.currentNode.textContent.trim() || !visible(el)) continue;
    if (el.closest('[disabled], .fv-pill--zero, .finance-skeleton, script, style, .fv-sr-only, .sr-only, option')) continue;
    done.add(el);
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    // element opacity (own and ancestors) lowers the effective text alpha
    let op = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fgc = over({ ...fg, a: fg.a * op }, bg);
    const L1 = lum(fgc);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    checked++;
    if (ratio < need) low.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} "${walker.currentNode.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}<${need}`);
  }
  return { checked, low };
};

async function boot(page, theme) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

for (const theme of ['light', 'dark']) {
  test(`Finance pages: text contrast >= 4.5:1 in ${theme}`, async ({ page }) => {
    await boot(page, theme);
    const failures = [];
    for (const [name, pageId, js, ready] of PAGES) {
      await openAdminPage(page, pageId);
      if (js) await page.evaluate(js);
      await page.locator(ready).first().waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(250);
      const r = await page.evaluate(SCAN, `#${pageId}`);
      if (r.error) { failures.push(`${name}: ${r.error}`); continue; }
      expect(r.checked, name).toBeGreaterThan(10);
      if (r.low.length) failures.push(`${name}: ${r.low.slice(0, 6).join(' | ')}`);
    }
    expect(failures, `Below the contrast threshold in ${theme}`).toEqual([]);
  });

  test(`Finance dialogs and drawer: text contrast >= 4.5:1 in ${theme}`, async ({ page }) => {
    await boot(page, theme);
    const failures = [];
    for (const [name, pageId, js, ready] of DIALOGS) {
      await openAdminPage(page, pageId);
      await page.waitForTimeout(500);
      await page.evaluate(js);
      await page.locator(ready).first().waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const r = await page.evaluate(SCAN, ready);
      if (r.error) { failures.push(`${name}: ${r.error}`); continue; }
      if (r.low.length) failures.push(`${name}: ${r.low.slice(0, 6).join(' | ')}`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active')); const d = document.getElementById('financeDetailDrawerOverlay'); if (d) d.style.display = 'none'; });
    }
    expect(failures, `Below the contrast threshold in ${theme}`).toEqual([]);
  });
}

test('Hero card: white text on both stops of the gradient, light and dark', async ({ page }) => {
  await boot(page, 'light');
  const read = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const ratio = (hexA, hexB) => {
    const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    const a = lum(toRgb(hexA)); const b = lum(toRgb(hexB));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const gradient = await read('--brand-gradient');
    const stops = gradient.match(/#[0-9a-fA-F]{6}/g);
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const stop of stops) expect(ratio('#ffffff', stop), `${theme} ${stop}`).toBeGreaterThanOrEqual(4.5);
  }
});
