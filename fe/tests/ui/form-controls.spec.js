import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// R2 One set of form controls: Finance Overview filters, the Record Statutory Obligation modal,
// dark-theme native selects and the bill-modal checkboxes all use the shared control look.

const THEMES = ['light', 'dark'];

async function boot(page, theme) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

const look = (locator) => locator.evaluate((el) => {
  const c = getComputedStyle(el);
  return {
    height: c.height,
    font: c.fontFamily,
    radius: c.borderTopLeftRadius,
    padTop: c.paddingTop,
    padBottom: c.paddingBottom,
    padLeft: c.paddingLeft,
    padRight: c.paddingRight,
  };
});

for (const theme of THEMES) {
  test.describe(`R2 form controls (${theme})`, () => {
    test('1. Finance Overview filters match a Reports filter select', async ({ page }) => {
      await boot(page, theme);
      await openAdminPage(page, 'a-finance-reports');
      const reference = await look(page.locator('#reportShellEntity'));
      const referenceDate = await look(page.locator('#reportShellDateFrom'));

      await openAdminPage(page, 'a-finance-dashboard');
      for (const id of ['financeContextEntity', 'financeContextPeriod', 'financeContextBasis', 'financeContextCurrency', 'filterAttentionSeverity', 'filterAttentionType']) {
        expect(await look(page.locator(`#${id}`)), id).toEqual(reference);
      }
      // The search input shares height, font and radius (its padding differs: it carries a search icon, not a chevron).
      const search = await look(page.locator('#inputAttentionSearch'));
      for (const key of ['height', 'font', 'radius']) {
        expect(search[key], `search ${key}`).toBe(reference[key]);
      }

      // Report date inputs match the same look (font, border radius, height).
      for (const key of ['height', 'font', 'radius']) {
        expect(referenceDate[key], `report date ${key}`).toBe(reference[key]);
      }
    });

    test('2. Record Statutory Obligation controls match Add Employee controls', async ({ page }) => {
      await boot(page, theme);
      await page.evaluate(() => openModal('employeeModal'));
      const emp = {
        input: await look(page.locator('#fEmpName')),
        date: await look(page.locator('#fEmpJoin')),
        select: await look(page.locator('#fEmpDept')),
      };
      await page.evaluate(() => closeModal('employeeModal'));

      await openAdminPage(page, 'a-finance-statutory');
      await page.evaluate(() => openModal('statutoryRecordModal'));
      const pairs = {
        statRecordPeriod: emp.date,
        statRecordAmount: emp.input,
        statRecordDueDate: emp.date,
        statRecordType: emp.select,
        statRecordCurrency: emp.select,
      };
      for (const [id, expected] of Object.entries(pairs)) {
        const got = await look(page.locator(`#${id}`));
        for (const key of ['height', 'font', 'radius']) expect(got[key], `${id} ${key}`).toBe(expected[key]);
      }
      const notes = await look(page.locator('#statRecordNotes'));
      expect(notes.font).toBe(emp.input.font);
      expect(notes.radius).toBe(emp.input.radius);
      await page.evaluate(() => closeModal('statutoryRecordModal'));
    });

    test('3. native selects show no repeated background pattern', async ({ page }) => {
      await boot(page, theme);
      const pages = ['a-employees', 'a-finance-bills', 'a-finance-dashboard', 'a-finance-statutory'];
      for (const pageId of pages) {
        await openAdminPage(page, pageId);
        const bad = await page.evaluate((id) => [...document.querySelectorAll(`#${id} select`)]
          .filter((s) => s.offsetParent !== null)
          .filter((s) => {
            const c = getComputedStyle(s);
            return c.backgroundImage !== 'none' && c.backgroundRepeat !== 'no-repeat';
          })
          .map((s) => s.id || s.className), pageId);
        expect(bad, `${pageId} selects with a tiled background`).toEqual([]);
      }
      // The employee profile Notes category select is the reported case.
      await page.evaluate(() => showSection('a-employee-detail', 'admin'));
      const note = await page.locator('#fNoteCategory').evaluate((s) => getComputedStyle(s).backgroundRepeat);
      expect(note).toBe('no-repeat');
    });
  });
}

test('5. element ids and onchange handlers on the filters are unchanged', async ({ page }) => {
  await boot(page, 'light');
  await openAdminPage(page, 'a-finance-dashboard');
  const handlers = await page.evaluate(() => Object.fromEntries(
    ['financeContextEntity', 'financeContextPeriod', 'financeContextBasis', 'financeContextCurrency']
      .map((id) => [id, document.getElementById(id).getAttribute('onchange')])));
  for (const h of Object.values(handlers)) expect(h).toBe('onFinanceContextChanged()');
  expect(await page.locator('#filterAttentionSeverity').getAttribute('onchange')).toBe('onAttentionFilterChanged()');
  expect(await page.locator('#filterAttentionType').getAttribute('onchange')).toBe('onAttentionFilterChanged()');
  expect(await page.locator('#inputAttentionSearch').getAttribute('oninput')).toBe('onAttentionSearchInput(event)');
});
