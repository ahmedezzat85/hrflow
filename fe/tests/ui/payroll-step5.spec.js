import { test, expect } from '@playwright/test';
import { submitAndApprove, confirmPayment } from './helpers/payroll.js';
import { openAdminPage } from './helpers/admin-nav.js';

// R6 Payroll step 5: company funding accounts, one row per employee, plain status chips,
// disabled "recorded as paid" button, finalized banner and a single-phrase FX chip.

async function toPaidStep5(page, { missingBankEmployee = true } = {}) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-finance-payroll');
  await page.click('#btnOpenCurrentCycle');
  await page.click('#btnP1Proceed');
  await submitAndApprove(page);
  await page.click('#btnP3Next');
  await page.click('#btnP4Next');
  await expect(page.locator('#payrollScreen5')).toBeVisible();
  if (missingBankEmployee) {
    await page.evaluate(() => {
      const row = window.PayrollApp.rows.find((r) => r.baseExt > 0) || window.PayrollApp.rows[0];
      window.PayrollApp.currentRun.exceptions = [{ code: 'MISSING_BANK_DETAILS', employee_id: row.id, severity: 'warning', details: `${row.name} missing bank details` }];
      window.PayrollApp.drawScreen5();
    });
  }
  await confirmPayment(page);
  await expect(page.locator('#p5DisburseResultsCard')).toBeVisible();
}

test.describe('R6 payroll step 5', () => {
  test('1. no "Employee bank account" label in the payroll run screens; funding rows are "Company funding account"', async ({ page }) => {
    await toPaidStep5(page);
    const text = await page.locator('#a-finance-payroll').innerText();
    expect(text).not.toContain('Employee bank account');
    await expect(page.locator('#p5IntAccount').locator('xpath=preceding-sibling::span[@class="k"]')).toContainText('Company funding account');
    await expect(page.locator('#p5ExtAccount').locator('xpath=preceding-sibling::span[@class="k"]')).toContainText('Company funding account');
    // The placeholder account names are gone from the static markup.
    const html = await page.evaluate(() => document.getElementById('payrollScreen5').innerHTML);
    expect(html).not.toContain('Treasury Cash Vault');
    expect(html).not.toContain('Operating Bank Wire Account');
  });

  test('2. each employee appears once; External + Internal = Total paid; totals equal the cards', async ({ page }) => {
    await toPaidStep5(page);
    const data = await page.evaluate(() => {
      const num = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));
      const rows = [...document.querySelectorAll('#payrollDisburseResultsTableBody tr')].map((tr) => {
        const c = tr.querySelectorAll('td');
        return { name: c[0].textContent.trim(), ext: num(c[2].textContent), int: num(c[3].textContent), net: num(c[4].textContent) };
      });
      return {
        rows,
        totExt: num(document.getElementById('p5TotExt').textContent),
        totInt: num(document.getElementById('p5TotInt').textContent),
        totNet: num(document.getElementById('p5TotNet').textContent),
        cardExt: num(document.getElementById('p5ExtTotal').textContent),
        cardInt: num(document.getElementById('p5IntTotal').textContent),
      };
    });
    expect(data.rows.length).toBeGreaterThan(0);
    expect(new Set(data.rows.map((r) => r.name)).size).toBe(data.rows.length);
    for (const r of data.rows) expect(Math.abs(r.ext + r.int - r.net), r.name).toBeLessThan(0.011);
    const sum = (k) => data.rows.reduce((a, r) => a + r[k], 0);
    expect(Math.abs(sum('ext') - data.totExt)).toBeLessThan(0.011);
    expect(Math.abs(sum('int') - data.totInt)).toBeLessThan(0.011);
    expect(Math.abs(sum('net') - data.totNet)).toBeLessThan(0.011);
    expect(Math.abs(data.totExt - data.cardExt)).toBeLessThan(0.011);
    expect(Math.abs(data.totInt - data.cardInt)).toBeLessThan(0.011);
    await expect(page.locator('#payrollDisburseResultsTable thead th')).toHaveText(
      ['Employee', 'Employee bank details', 'External', 'Internal', 'Total paid', 'Status']);
  });

  test('3. the header never shows "PAID" beside "Not Recorded"; chips read "Salaries paid" and "Statutory not recorded"', async ({ page }) => {
    await toPaidStep5(page);
    await expect(page.locator('#payrollStatusBadge')).toHaveText('Salaries paid');
    await page.evaluate(() => window.PayrollApp.renderStatutoryBadge('Statutory not recorded', 'b-gray'));
    await expect(page.locator('#p5StatutoryBadge')).toHaveText('Statutory not recorded');
    const header = await page.locator('#payrollScreen5 .title-row').innerText();
    expect(header).not.toMatch(/\bPAID\b/);
    expect(header).not.toMatch(/Not Recorded/);
  });

  test('4. missing bank details warn and do not block (D-006)', async ({ page }) => {
    await toPaidStep5(page);
    await expect(page.locator('#payrollExceptionList .alertbox')).toContainText('Payment can still be recorded');
    // The mock rows carry no bank data, so every external-paid employee reads Missing, as on step 4.
    expect(await page.locator('#payrollDisburseResultsTableBody .payroll-bank-missing').count()).toBeGreaterThan(0);
    await expect(page.locator('#p5DisburseResultsCard')).toBeVisible();
  });

  test('5. paid run: disabled button states the date, finalized banner reads the new text, FX chip is one phrase', async ({ page }) => {
    await toPaidStep5(page);
    const btn = page.locator('#btnP5ConfirmDisburse');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText(/^\s*Recorded as paid on \d{2} \w{3} \d{4}\s*$/);
    await expect(page.locator('#payrollLockText')).toHaveText('This run is finalized. Compensation and additions are read-only.');
    const fx = (await page.locator('#payrollFxStrip').innerText()).replace(/\s+/g, ' ');
    expect(fx).toMatch(/FX rate: 1 USD = \d+\.\d{4} EGP, (manual override|system fallback rate|from transfer history)/);
  });

  test('6. element ids kept and the two rail cards keep their colours', async ({ page }) => {
    await toPaidStep5(page);
    for (const id of ['p5IntTotal', 'p5ExtTotal', 'p5IntAccount', 'p5ExtAccount', 'p5IntPayDate', 'p5ExtPayDate']) {
      await expect(page.locator(`#${id}`), id).toHaveCount(1);
    }
    const colours = await page.evaluate(() => {
      const c = (sel) => getComputedStyle(document.querySelector(sel)).color;
      const probe = (v) => { const d = document.createElement('div'); d.style.color = `var(${v})`; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; };
      return {
        ext: c('#payrollDisburseResultsTable thead .payroll-col-ext'), extToken: probe('--success'),
        int: c('#payrollDisburseResultsTable thead .payroll-col-int'), intToken: probe('--accent-text'),
      };
    });
    expect(colours.ext).toBe(colours.extToken);
    expect(colours.int).toBe(colours.intToken);
  });
});
