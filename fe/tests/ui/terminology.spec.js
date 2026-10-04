import { test, expect } from '@playwright/test';

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof showSection === 'function' && window.AdminNav);
}

// Visible text of an element subtree, ignoring script/style/templates and ids/attributes.
const VISIBLE_TEXT = `(root) => {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const el = w.currentNode.parentElement;
    if (!el || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
    const t = w.currentNode.textContent.trim();
    if (t) out.push(t);
  }
  root.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => {
    ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v) out.push(v); });
  });
  return out;
}`;

test.describe('U4 terminology', () => {
  test('HR salary payment docs page and its modals never say "Invoice"', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-invoices', 'admin'));
    const texts = await page.evaluate(`(() => {
      const f = ${VISIBLE_TEXT};
      return ['#a-invoices', '#bulkInvoiceModal', '#regenerateInvoiceModal', '#invoicePeriodModal']
        .flatMap((s) => f(document.querySelector(s)));
    })()`);
    expect(texts.filter((t) => /invoice/i.test(t))).toEqual([]);
    expect(texts.join(' ')).toContain('Salary payment doc');
  });

  test('HR employee form and export dataset use payment doc wording', async ({ page }) => {
    await openAdmin(page);
    const texts = await page.evaluate(`(() => {
      const f = ${VISIBLE_TEXT};
      return ['#employeeModal', '#exportModal'].flatMap((s) => { const r = document.querySelector(s); return r ? f(r) : []; });
    })()`);
    expect(texts.join(' | ')).toContain('Payment doc ID');
    expect(texts.join(' | ')).toContain('Salary payment docs');
    expect(texts.filter((t) => /Invoice ID|Contractor Invoices|Consultant Invoic/i.test(t))).toEqual([]);
  });

  test('every static "bank account" label says Employee or Company', async ({ page }) => {
    await openAdmin(page);
    const offenders = await page.evaluate(`(() => {
      const f = ${VISIBLE_TEXT};
      const bad = [];
      for (const t of f(document.body)) {
        for (const m of t.matchAll(/(\\S+\\s+)?bank (&|and) cash accounts?|(\\S+\\s+)?bank accounts?/gi)) {
          const before = (m[1] || m[3] || '').trim().toLowerCase();
          if (!['employee', 'company'].includes(before)) bad.push(t);
        }
      }
      return [...new Set(bad)];
    })()`);
    expect(offenders).toEqual([]);
  });
});
